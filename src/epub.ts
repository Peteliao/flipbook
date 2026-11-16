import JSZip from 'jszip'

export type TextConverter = (text: string) => string

export interface EpubInfo {
  title: string
  author: string
  chapterCount: number
  coverUrl?: string
  previewSnippet?: string
}

export interface ConvertResult {
  blob: Blob
  info: EpubInfo
  convertedFiles: number
  changedSegments: number
  previewOriginal?: string
  previewConverted?: string
}

export interface ConvertOptions {
  direction: 't2s' | 's2t'
  convertVocab?: boolean
  convertQuotes?: boolean
}

interface ManifestItem {
  id: string
  href: string
  mediaType: string
  properties?: string
}

const TEXT_MEDIA_TYPES = new Set([
  'application/xhtml+xml',
  'application/x-dtbncx+xml',
  'text/html',
  'text/xml',
  'application/xml',
])

const TEXT_EXTS = new Set(['xhtml', 'html', 'htm', 'ncx', 'xml'])

const SKIP_TAGS = new Set(['script', 'style', 'code', 'pre'])
const TRANSLATABLE_ATTRS = ['title', 'alt', 'aria-label']
const DC_FIELDS = ['title', 'creator', 'description', 'subject', 'publisher', 'contributor']

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': '&#160;',
  '&ldquo;': '&#8220;',
  '&rdquo;': '&#8221;',
  '&lsquo;': '&#8216;',
  '&rsquo;': '&#8217;',
  '&mdash;': '&#8212;',
  '&ndash;': '&#8211;',
  '&hellip;': '&#8230;',
  '&middot;': '&#183;',
  '&copy;': '&#169;',
  '&reg;': '&#174;',
  '&trade;': '&#8482;',
  '&bull;': '&#8226;',
  '&prime;': '&#8242;',
  '&Prime;': '&#8243;',
}

function sanitizeEntitiesForXml(text: string): string {
  return text.replace(
    /&(?:nbsp|ldquo|rdquo|lsquo|rsquo|mdash|ndash|hellip|middot|copy|reg|trade|bull|prime|Prime);/g,
    (match) => HTML_ENTITIES[match] || match,
  )
}

function parseXml(text: string): Document | null {
  const sanitized = sanitizeEntitiesForXml(text)
  const doc = new DOMParser().parseFromString(sanitized, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return null
  return doc
}

function resolvePath(baseDir: string, href: string): string {
  const parts = (baseDir ? baseDir + '/' : '').split('/')
  for (const seg of decodeURIComponent(href).split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.filter(Boolean).join('/')
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

async function checkDrm(zip: JSZip) {
  const encFile = zip.file('META-INF/encryption.xml')
  if (encFile) {
    const text = await encFile.async('string')
    if (
      text.includes('http://ns.adobe.com/adept') ||
      text.includes('application/vnd.adobe.adept') ||
      text.includes('.xhtml') ||
      text.includes('.html')
    ) {
      throw new Error('该 EPUB 文件受 DRM 数字版权保护，无法直接解析或转换。请先在本地解除 DRM 保护。')
    }
  }
  const rightsFile = zip.file('META-INF/rights.xml')
  if (rightsFile) {
    throw new Error('该 EPUB 文件受 DRM 权限保护，无法转换。')
  }
}

async function findOpfPath(zip: JSZip): Promise<string> {
  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) throw new Error('不是有效的 EPUB：缺少 META-INF/container.xml')
  const doc = parseXml(await containerFile.async('string'))
  const rootfile = doc?.getElementsByTagName('rootfile')[0]
  const path = rootfile?.getAttribute('full-path')
  if (!path) throw new Error('不是有效的 EPUB：container.xml 中未找到 OPF 路径')
  return path
}

function findMetaElements(meta: Element, localTag: string): Element[] {
  const nsList = Array.from(meta.getElementsByTagNameNS?.('*', localTag) ?? [])
  if (nsList.length > 0) return nsList

  const dcList = Array.from(meta.getElementsByTagName(`dc:${localTag}`))
  if (dcList.length > 0) return dcList

  const directList = Array.from(meta.getElementsByTagName(localTag))
  if (directList.length > 0) return directList

  return Array.from(meta.children).filter((el) => {
    const name = el.localName || el.tagName || ''
    return name === localTag || name.endsWith(':' + localTag)
  })
}

function readInfo(opfDoc: Document, chapterCount: number): EpubInfo {
  const meta = opfDoc.getElementsByTagName('metadata')[0]
  const pick = (tag: string) => {
    if (!meta) return ''
    const els = findMetaElements(meta, tag)
    return els[0]?.textContent?.trim() ?? ''
  }
  return {
    title: pick('title') || '未知书名',
    author: pick('creator'),
    chapterCount,
  }
}

async function extractCover(
  zip: JSZip,
  opfDoc: Document,
  opfDir: string,
): Promise<string | undefined> {
  const items = Array.from(opfDoc.getElementsByTagName('item'))
  let coverHref: string | undefined
  let mediaType: string | undefined

  // 1. EPUB 3: properties="cover-image"
  for (const item of items) {
    const props = item.getAttribute('properties') ?? ''
    if (props.split(/\s+/).includes('cover-image')) {
      coverHref = item.getAttribute('href') ?? undefined
      mediaType = item.getAttribute('media-type') ?? undefined
      break
    }
  }

  // 2. EPUB 2: <meta name="cover" content="cover-item-id"/>
  if (!coverHref) {
    const metas = Array.from(opfDoc.getElementsByTagName('meta'))
    const coverMeta = metas.find((m) => m.getAttribute('name') === 'cover')
    const coverId = coverMeta?.getAttribute('content')
    if (coverId) {
      const item = items.find((it) => it.getAttribute('id') === coverId)
      if (item) {
        coverHref = item.getAttribute('href') ?? undefined
        mediaType = item.getAttribute('media-type') ?? undefined
      }
    }
  }

  // 3. Fallback: item with id or href matching "cover" and image mediaType
  if (!coverHref) {
    const item = items.find((it) => {
      const id = (it.getAttribute('id') ?? '').toLowerCase()
      const href = (it.getAttribute('href') ?? '').toLowerCase()
      const mt = (it.getAttribute('media-type') ?? '').toLowerCase()
      return mt.startsWith('image/') && (id.includes('cover') || href.includes('cover'))
    })
    if (item) {
      coverHref = item.getAttribute('href') ?? undefined
      mediaType = item.getAttribute('media-type') ?? undefined
    }
  }

  if (coverHref) {
    const fullPath = resolvePath(opfDir, coverHref)
    const file = zip.file(fullPath)
    if (file) {
      try {
        const b64 = await file.async('base64')
        const mt = mediaType || (fullPath.endsWith('.png') ? 'image/png' : 'image/jpeg')
        return `data:${mt};base64,${b64}`
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

function walkTextNodes(root: Node, callback: (node: Text) => void) {
  function walk(node: Node) {
    if (node.nodeType === 9 || node.nodeType === 11) {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        walk(child)
      }
    } else if (node.nodeType === 1) {
      const el = node as Element
      const tag = (el.localName || el.nodeName || '').toLowerCase()
      if (SKIP_TAGS.has(tag) || el.getAttribute('translate') === 'no') {
        return
      }
      for (let child = el.firstChild; child; child = child.nextSibling) {
        walk(child)
      }
    } else if (node.nodeType === 3) {
      callback(node as Text)
    }
  }
  walk(root)
}

function convertDoc(root: Element | Document, convert: TextConverter): number {
  let changed = 0

  // 1. Text nodes
  walkTextNodes(root, (node) => {
    const old = node.nodeValue ?? ''
    if (!old.trim()) return
    const next = convert(old)
    if (next !== old) {
      node.nodeValue = next
      changed++
    }
  })

  // 2. Translatable attributes (title, alt, aria-label)
  const elements = root.getElementsByTagName('*')
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    const tag = (el.localName || el.nodeName || '').toLowerCase()
    if (SKIP_TAGS.has(tag) || el.getAttribute('translate') === 'no') continue
    for (const attr of TRANSLATABLE_ATTRS) {
      if (el.hasAttribute(attr)) {
        const oldVal = el.getAttribute(attr) ?? ''
        if (oldVal.trim()) {
          const nextVal = convert(oldVal)
          if (nextVal !== oldVal) {
            el.setAttribute(attr, nextVal)
            changed++
          }
        }
      }
    }
  }

  return changed
}

async function loadEpub(file: File) {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer())
  } catch {
    throw new Error('无法读取该文件：不是有效的 EPUB（ZIP）格式')
  }
  await checkDrm(zip)
  const opfPath = await findOpfPath(zip)
  const opfFile = zip.file(opfPath)
  if (!opfFile) throw new Error('不是有效的 EPUB：找不到 OPF 文件 ' + opfPath)
  const opfDoc = parseXml(await opfFile.async('string'))
  if (!opfDoc) throw new Error('不是有效的 EPUB：OPF 文件解析失败')
  return { zip, opfPath, opfDoc }
}

const SAMPLE_FILES = 8
const SAMPLE_CHARS = 20_000

function getSpineOrderedPaths(opfDoc: Document, opfDir: string, zip: JSZip): string[] {
  const paths = new Map<string, string>()
  for (const item of Array.from(opfDoc.getElementsByTagName('item'))) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (id && href) paths.set(id, resolvePath(opfDir, href))
  }
  const ordered: string[] = []
  const spine = opfDoc.getElementsByTagName('spine')[0]
  if (spine) {
    for (const ref of Array.from(spine.getElementsByTagName('itemref'))) {
      const idref = ref.getAttribute('idref')
      const path = idref ? paths.get(idref) : undefined
      if (path && zip.file(path)) ordered.push(path)
    }
  }
  if (!ordered.length) {
    for (const p of paths.values()) if (zip.file(p)) ordered.push(p)
  }
  return ordered
}

async function collectSampleAndPreview(
  zip: JSZip,
  opfDoc: Document,
  opfDir: string,
): Promise<{ sample: string; previewSnippet: string }> {
  const ordered = getSpineOrderedPaths(opfDoc, opfDir, zip)
  let sample = ''
  let previewSnippet = ''

  for (const path of ordered.slice(0, SAMPLE_FILES)) {
    const file = zip.file(path)
    if (!file) continue
    const raw = await file.async('string')
    const doc = new DOMParser().parseFromString(sanitizeEntitiesForXml(raw), 'text/html')
    doc.querySelectorAll('script, style').forEach((el) => el.remove())

    if (!previewSnippet) {
      // Find the first substantial paragraph or heading for preview
      const nodes = doc.querySelectorAll('h1, h2, h3, h4, p')
      let textAcc = ''
      for (const el of Array.from(nodes)) {
        const t = (el.textContent ?? '').trim()
        if (t.length > 5) {
          textAcc += (textAcc ? '\n\n' : '') + t
          if (textAcc.length >= 260) break
        }
      }
      if (!textAcc) textAcc = (doc.body?.textContent ?? '').trim().slice(0, 300)
      previewSnippet = textAcc.slice(0, 350)
    }

    sample += ' ' + (doc.body?.textContent ?? '')
    if (sample.length >= SAMPLE_CHARS) break
  }

  return { sample: sample.slice(0, SAMPLE_CHARS), previewSnippet }
}

export async function readEpubInfo(file: File): Promise<{ info: EpubInfo; sample: string }> {
  const { zip, opfPath, opfDoc } = await loadEpub(file)
  const opfDir = dirOf(opfPath)
  const spine = opfDoc.getElementsByTagName('spine')[0]
  const chapterCount = spine ? spine.getElementsByTagName('itemref').length : 0
  const baseInfo = readInfo(opfDoc, chapterCount)
  const coverUrl = await extractCover(zip, opfDoc, opfDir)
  const { sample, previewSnippet } = await collectSampleAndPreview(zip, opfDoc, opfDir)

  const info: EpubInfo = {
    ...baseInfo,
    coverUrl,
    previewSnippet,
  }
  return { info, sample: `${info.title} ${sample}` }
}

export function createQuotationConverter(dir: 't2s' | 's2t'): (text: string) => string {
  if (dir === 't2s') {
    return (text: string) =>
      text
        .replace(/「/g, '“')
        .replace(/」/g, '”')
        .replace(/『/g, '‘')
        .replace(/』/g, '’')
  } else {
    return (text: string) =>
      text
        .replace(/“/g, '「')
        .replace(/”/g, '」')
        .replace(/‘/g, '『')
        .replace(/’/g, '』')
  }
}

export async function convertEpub(
  file: File,
  convert: TextConverter,
  options: ConvertOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<ConvertResult> {
  const { zip, opfPath, opfDoc } = await loadEpub(file)
  const opfDir = dirOf(opfPath)

  const items: ManifestItem[] = []
  for (const item of Array.from(opfDoc.getElementsByTagName('item'))) {
    const id = item.getAttribute('id') ?? ''
    const href = item.getAttribute('href') ?? ''
    const mediaType = item.getAttribute('media-type') ?? ''
    const properties = item.getAttribute('properties') ?? undefined
    if (href) items.push({ id, href, mediaType, properties })
  }

  const targets = items
    .filter((it) => {
      if (TEXT_MEDIA_TYPES.has(it.mediaType.toLowerCase())) return true
      const ext = it.href.split('.').pop()?.toLowerCase() ?? ''
      return TEXT_EXTS.has(ext)
    })
    .map((it) => resolvePath(opfDir, it.href))
    .filter((path) => Boolean(zip.file(path)))

  const total = targets.length + 2
  let done = 0
  const replacements = new Map<string, string>()
  let changedSegments = 0

  const targetLang = options.direction === 't2s' ? 'zh-CN' : 'zh-TW'
  const targetHtmlLang = options.direction === 't2s' ? 'zh-CN' : 'zh-TW'

  for (const path of targets) {
    const text = await zip.file(path)!.async('string')
    let doc = parseXml(text)
    let serialize: (d: Document) => string
    if (doc) {
      serialize = (d) => new XMLSerializer().serializeToString(d)
    } else {
      doc = new DOMParser().parseFromString(sanitizeEntitiesForXml(text), 'text/html')
      serialize = (d) =>
        '<!DOCTYPE html>\n' + new XMLSerializer().serializeToString(d.documentElement)
    }

    // Sync html lang attributes
    const rootEl = doc.documentElement
    if (rootEl) {
      if (rootEl.hasAttribute('lang')) rootEl.setAttribute('lang', targetHtmlLang)
      if (rootEl.hasAttribute('xml:lang')) rootEl.setAttribute('xml:lang', targetHtmlLang)
    }

    changedSegments += convertDoc(doc, convert)
    replacements.set(path, serialize(doc))
    onProgress?.(++done, total)
    await new Promise((r) => setTimeout(r, 0))
  }

  // Update OPF metadata
  const meta = opfDoc.getElementsByTagName('metadata')[0]
  if (meta) {
    // 1. Update <dc:language>
    const langEls = findMetaElements(meta, 'language')
    if (langEls.length > 0) {
      for (let i = 0; i < langEls.length; i++) {
        langEls[i].textContent = targetLang
      }
    } else {
      const newLangEl = opfDoc.createElementNS('http://purl.org/dc/elements/1.1/', 'dc:language')
      newLangEl.textContent = targetLang
      meta.appendChild(newLangEl)
    }

    // 2. Convert metadata fields (title, creator, description, etc.)
    for (const field of DC_FIELDS) {
      for (const el of findMetaElements(meta, field)) {
        const old = el.textContent ?? ''
        const next = convert(old)
        if (next !== old) {
          el.textContent = next
          changedSegments++
        }
      }
    }
  }

  replacements.set(opfPath, new XMLSerializer().serializeToString(opfDoc))
  onProgress?.(++done, total)

  // In-place update to avoid duplicating unmodified binary assets (images, fonts)
  for (const [name, content] of replacements) {
    zip.file(name, content, { compression: 'DEFLATE' })
  }
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

  const blob = await zip.generateAsync(
    { type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' },
    (m) => onProgress?.(total - 1 + m.percent / 100, total),
  )
  onProgress?.(total, total)

  const spine = opfDoc.getElementsByTagName('spine')[0]
  const baseInfo = readInfo(opfDoc, spine ? spine.getElementsByTagName('itemref').length : 0)
  const coverUrl = await extractCover(zip, opfDoc, opfDir)

  return {
    blob,
    info: { ...baseInfo, coverUrl },
    convertedFiles: replacements.size,
    changedSegments,
  }
}
