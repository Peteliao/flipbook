import JSZip from 'jszip'

export type TextConverter = (text: string) => string

export interface EpubInfo {
  title: string
  author: string
  chapterCount: number
}

export interface ConvertResult {
  blob: Blob
  info: EpubInfo
  convertedFiles: number
  changedSegments: number
}

interface ManifestItem {
  href: string
  mediaType: string
}

const XML_TYPES = new Set(['application/xhtml+xml', 'application/x-dtbncx+xml'])
const SKIP_TAGS = new Set(['script', 'style', 'code', 'pre'])
const DC_FIELDS = ['title', 'creator', 'description', 'subject', 'publisher', 'contributor']

function parseXml(text: string): Document | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
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

async function findOpfPath(zip: JSZip): Promise<string> {
  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) throw new Error('不是有效的 EPUB：缺少 META-INF/container.xml')
  const doc = parseXml(await containerFile.async('string'))
  const rootfile = doc?.getElementsByTagName('rootfile')[0]
  const path = rootfile?.getAttribute('full-path')
  if (!path) throw new Error('不是有效的 EPUB：container.xml 中未找到 OPF 路径')
  return path
}

function readInfo(opfDoc: Document, chapterCount: number): EpubInfo {
  const meta = opfDoc.getElementsByTagName('metadata')[0]
  const pick = (tag: string) => {
    if (!meta) return ''
    const els = meta.getElementsByTagNameNS('*', tag)
    return els[0]?.textContent?.trim() ?? ''
  }
  return { title: pick('title') || '未知书名', author: pick('creator'), chapterCount }
}

function convertTextNodes(root: Element | Document, convert: TextConverter): number {
  const doc = root.ownerDocument ?? (root as Document)
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement
      while (el) {
        if (SKIP_TAGS.has(el.localName) || el.getAttribute('translate') === 'no') {
          return NodeFilter.FILTER_REJECT
        }
        el = el.parentElement
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let changed = 0
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const old = node.nodeValue ?? ''
    if (!old.trim()) continue
    const next = convert(old)
    if (next !== old) {
      node.nodeValue = next
      changed++
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
  const opfPath = await findOpfPath(zip)
  const opfFile = zip.file(opfPath)
  if (!opfFile) throw new Error('不是有效的 EPUB：找不到 OPF 文件 ' + opfPath)
  const opfDoc = parseXml(await opfFile.async('string'))
  if (!opfDoc) throw new Error('不是有效的 EPUB：OPF 文件解析失败')
  return { zip, opfPath, opfDoc }
}

const SAMPLE_FILES = 8
const SAMPLE_CHARS = 20_000

async function collectSample(zip: JSZip, opfDoc: Document, opfDir: string): Promise<string> {
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

  let sample = ''
  for (const path of ordered.slice(0, SAMPLE_FILES)) {
    const doc = new DOMParser().parseFromString(await zip.file(path)!.async('string'), 'text/html')
    doc.querySelectorAll('script, style').forEach((el) => el.remove())
    sample += ' ' + (doc.body?.textContent ?? '')
    if (sample.length >= SAMPLE_CHARS) break
  }
  return sample.slice(0, SAMPLE_CHARS)
}

export async function readEpubInfo(file: File): Promise<{ info: EpubInfo; sample: string }> {
  const { zip, opfPath, opfDoc } = await loadEpub(file)
  const spine = opfDoc.getElementsByTagName('spine')[0]
  const chapterCount = spine ? spine.getElementsByTagName('itemref').length : 0
  const info = readInfo(opfDoc, chapterCount)
  const sample = `${info.title} ${await collectSample(zip, opfDoc, dirOf(opfPath))}`
  return { info, sample }
}

export async function convertEpub(
  file: File,
  convert: TextConverter,
  onProgress?: (done: number, total: number) => void,
): Promise<ConvertResult> {
  const { zip, opfPath, opfDoc } = await loadEpub(file)
  const opfDir = dirOf(opfPath)

  const items: ManifestItem[] = []
  for (const item of Array.from(opfDoc.getElementsByTagName('item'))) {
    const href = item.getAttribute('href')
    const mediaType = item.getAttribute('media-type') ?? ''
    if (href) items.push({ href, mediaType })
  }
  const targets = items
    .filter((it) => XML_TYPES.has(it.mediaType))
    .map((it) => resolvePath(opfDir, it.href))
    .filter((path) => zip.file(path))

  const total = targets.length + 2
  let done = 0
  const replacements = new Map<string, string>()
  let changedSegments = 0

  for (const path of targets) {
    const text = await zip.file(path)!.async('string')
    let doc = parseXml(text)
    let serialize: (d: Document) => string
    if (doc) {
      serialize = (d) => new XMLSerializer().serializeToString(d)
    } else {
      doc = new DOMParser().parseFromString(text, 'text/html')
      serialize = (d) => '<!DOCTYPE html>\n' + new XMLSerializer().serializeToString(d.documentElement)
    }
    changedSegments += convertTextNodes(doc, convert)
    replacements.set(path, serialize(doc))
    onProgress?.(++done, total)
    await new Promise((r) => setTimeout(r, 0))
  }

  const meta = opfDoc.getElementsByTagName('metadata')[0]
  if (meta) {
    for (const field of DC_FIELDS) {
      for (const el of Array.from(meta.getElementsByTagNameNS('*', field))) {
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

  const out = new JSZip()
  out.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  const names = Object.keys(zip.files).filter((n) => n !== 'mimetype' && !zip.files[n].dir)
  for (const name of names) {
    const content = replacements.has(name)
      ? replacements.get(name)!
      : await zip.files[name].async('uint8array')
    out.file(name, content, { compression: 'DEFLATE' })
  }

  const blob = await out.generateAsync(
    { type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' },
    (m) => onProgress?.(total - 1 + m.percent / 100, total),
  )
  onProgress?.(total, total)

  const spine = opfDoc.getElementsByTagName('spine')[0]
  const info = readInfo(opfDoc, spine ? spine.getElementsByTagName('itemref').length : 0)
  return { blob, info, convertedFiles: replacements.size, changedSegments }
}