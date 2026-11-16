import './style.css'
import {
  inspectFile,
  convertBook,
  previewSnippet,
  type InspectedBook,
  type ConvertedBook,
} from './service'
import type { ConvertOptions } from './epub'

type Direction = 't2s' | 's2t'
type Mode = 'auto' | Direction
type Theme = 'auto' | 'light' | 'dark'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// Header & Theme
const btnTheme = $<HTMLButtonElement>('btn-theme')

// Dropzone & Inputs
const dropzone = $<HTMLElement>('dropzone')
const fileInput = $<HTMLInputElement>('file-input')
const optionsPanel = $<HTMLElement>('options-panel')
const optVocab = $<HTMLInputElement>('opt-vocab')
const optQuotes = $<HTMLInputElement>('opt-quotes')
const vocabHint = $<HTMLSpanElement>('vocab-hint')

// Single Card
const bookCard = $<HTMLElement>('book-card')
const bookCoverImg = $<HTMLImageElement>('book-cover-img')
const bookCoverFallback = $<HTMLElement>('book-cover-fallback')
const bookTitle = $<HTMLDivElement>('book-title')
const bookMeta = $<HTMLDivElement>('book-meta')
const detectLine = $<HTMLDivElement>('detect-line')
const detectText = $<HTMLDivElement>('detect-text')
const btnConvert = $<HTMLButtonElement>('btn-convert')
const btnPreviewBefore = $<HTMLButtonElement>('btn-preview-before')
const btnReset = $<HTMLButtonElement>('btn-reset')
const progressWrap = $<HTMLDivElement>('progress-wrap')
const progressFill = $<HTMLDivElement>('progress-fill')
const progressText = $<HTMLDivElement>('progress-text')
const errorBox = $<HTMLDivElement>('error')

// Single Result Card
const resultCard = $<HTMLElement>('result-card')
const resultTitle = $<HTMLDivElement>('result-title')
const resultMeta = $<HTMLDivElement>('result-meta')
const btnDownload = $<HTMLButtonElement>('btn-download')
const btnPreviewAfter = $<HTMLButtonElement>('btn-preview-after')
const btnAgain = $<HTMLButtonElement>('btn-again')

// Batch Card
const batchCard = $<HTMLElement>('batch-card')
const batchMeta = $<HTMLDivElement>('batch-meta')
const batchList = $<HTMLDivElement>('batch-list')
const batchOverallProgress = $<HTMLDivElement>('batch-overall-progress')
const batchProgressFill = $<HTMLDivElement>('batch-progress-fill')
const batchProgressText = $<HTMLDivElement>('batch-progress-text')
const btnBatchConvert = $<HTMLButtonElement>('btn-batch-convert')
const btnBatchZip = $<HTMLButtonElement>('btn-batch-zip')
const btnBatchReset = $<HTMLButtonElement>('btn-batch-reset')
const btnBatchClear = $<HTMLButtonElement>('btn-batch-clear')

// Preview Modal
const previewModal = $<HTMLDivElement>('preview-modal')
const previewOriginalContent = $<HTMLDivElement>('preview-original-content')
const previewConvertedContent = $<HTMLDivElement>('preview-converted-content')
const btnModalClose = $<HTMLButtonElement>('btn-modal-close')
const btnModalOk = $<HTMLButtonElement>('btn-modal-ok')

// ---------------- State ----------------

interface BatchItem {
  file: File
  id: string
  inspected?: InspectedBook
  status: 'inspecting' | 'ready' | 'converting' | 'done' | 'error'
  progress: number
  result?: ConvertedBook
  errorMsg?: string
  targetDir?: Direction
}

let currentSingle: InspectedBook | null = null
let currentResult: ConvertedBook | null = null
let currentResultDirection: Direction = 't2s'
let batchQueue: BatchItem[] = []
let isBatchMode = false
let isBusy = false

const targetLabel = (dir: Direction) => (dir === 't2s' ? '简体' : '繁体')

function show(el: HTMLElement, visible: boolean) {
  el.classList.toggle('hidden', !visible)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  const kb = bytes / 1024
  if (kb < 1024) return kb.toFixed(1) + ' KB'
  return (kb / 1024).toFixed(1) + ' MB'
}

// ---------------- Theme Management ----------------

function initTheme() {
  const saved = (localStorage.getItem('flipbook-theme') as Theme) || 'auto'
  applyTheme(saved)
}

function applyTheme(theme: Theme) {
  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', theme)
  }
  localStorage.setItem('flipbook-theme', theme)
}

function cycleTheme() {
  const current = (localStorage.getItem('flipbook-theme') as Theme) || 'auto'
  const next: Theme = current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto'
  applyTheme(next)
}

btnTheme.addEventListener('click', cycleTheme)
initTheme()

// ---------------- Global Drag Protection ----------------

window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// ---------------- Options & Direction ----------------

function currentMode(): Mode {
  const checked = document.querySelector<HTMLInputElement>('input[name="direction"]:checked')
  return (checked?.value as Mode) ?? 'auto'
}

function resolveDirectionForBook(
  inspected?: InspectedBook,
): { dir: Direction; note: string; warn: boolean } {
  const mode = currentMode()
  if (mode !== 'auto') {
    return { dir: mode, note: `手动指定：将转换为${targetLabel(mode)}中文`, warn: false }
  }
  if (!inspected || !inspected.detection || inspected.detection.source === 'unknown') {
    const reason = !inspected?.detection?.hasChinese
      ? '未检测到足够的中文字符，建议核对书籍语言'
      : '未明确判定繁简体，默认按繁体 → 简体处理'
    return { dir: 't2s', note: reason, warn: true }
  }
  const { source, confidence } = inspected.detection
  const dir: Direction = source === 'traditional' ? 't2s' : 's2t'
  const sourceLabel = source === 'traditional' ? '繁体' : '简体'
  return {
    dir,
    note: `已识别${sourceLabel}中文（置信度 ${confidence}%）· 将转换为${targetLabel(dir)}`,
    warn: confidence < 65,
  }
}

function updateDirectionUI() {
  const { dir, note, warn } = resolveDirectionForBook(currentSingle ?? undefined)
  btnConvert.textContent = `转换为${targetLabel(dir)}`
  detectText.textContent = note
  detectLine.dataset.state = warn ? 'warn' : 'ok'
  vocabHint.textContent =
    dir === 't2s' ? '記憶體 → 内存 · 滑鼠 → 鼠标' : '内存 → 記憶體 · 鼠标 → 滑鼠'

  // Update batch items target labels if in batch mode
  if (isBatchMode) {
    renderBatchList()
  }
}

document.querySelectorAll<HTMLInputElement>('input[name="direction"]').forEach((el) => {
  el.addEventListener('change', updateDirectionUI)
})
optVocab.addEventListener('change', updateDirectionUI)
optQuotes.addEventListener('change', updateDirectionUI)

// ---------------- Reset & State ----------------

function resetAll() {
  currentSingle = null
  currentResult = null
  batchQueue = []
  isBatchMode = false
  isBusy = false
  fileInput.value = ''

  show(optionsPanel, false)
  show(bookCard, false)
  show(batchCard, false)
  show(resultCard, false)
  show(progressWrap, false)
  show(errorBox, false)
  show(dropzone, true)
  show(batchOverallProgress, false)
  btnConvert.disabled = false
  btnBatchConvert.disabled = false
  show(btnBatchZip, false)
}

// ---------------- Cover Render Helper ----------------

function applyCover(
  coverUrl: string | undefined,
  imgEl: HTMLImageElement,
  fallbackEl: HTMLElement,
) {
  if (coverUrl) {
    imgEl.src = coverUrl
    show(imgEl, true)
    show(fallbackEl, false)
  } else {
    imgEl.src = ''
    show(imgEl, false)
    show(fallbackEl, true)
  }
}

// ---------------- Single File Handling ----------------

async function handleSingleFile(file: File) {
  isBatchMode = false
  resetAll()
  show(dropzone, false)
  show(optionsPanel, true)
  show(bookCard, true)

  bookTitle.textContent = file.name
  bookMeta.textContent = `${formatBytes(file.size)} · 正在解析图书结构与繁简类型…`
  applyCover(undefined, bookCoverImg, bookCoverFallback)
  btnConvert.disabled = true
  btnPreviewBefore.disabled = true
  show(errorBox, false)

  try {
    const inspected = await inspectFile(file)
    currentSingle = inspected
    bookTitle.textContent = inspected.info.title
    const parts = [
      file.name,
      inspected.info.author && `作者：${inspected.info.author}`,
      `${inspected.info.chapterCount} 个章节`,
      formatBytes(file.size),
    ].filter(Boolean)
    bookMeta.textContent = parts.join(' · ')
    applyCover(inspected.info.coverUrl, bookCoverImg, bookCoverFallback)
    btnConvert.disabled = false
    btnPreviewBefore.disabled = !inspected.previewOriginal
    updateDirectionUI()
  } catch (err) {
    btnConvert.disabled = true
    btnPreviewBefore.disabled = true
    errorBox.textContent = err instanceof Error ? err.message : '文件解析失败'
    show(errorBox, true)
  }
}

// ---------------- Batch Mode Handling ----------------

async function handleMultipleFiles(files: File[]) {
  isBatchMode = true
  resetAll()
  isBatchMode = true
  show(dropzone, false)
  show(optionsPanel, true)
  show(batchCard, true)

  batchQueue = files.map((file, idx) => ({
    file,
    id: `batch_${Date.now()}_${idx}`,
    status: 'inspecting',
    progress: 0,
  }))

  renderBatchList()

  // Inspect each file in parallel/queue
  for (const item of batchQueue) {
    try {
      const inspected = await inspectFile(item.file)
      item.inspected = inspected
      item.status = 'ready'
    } catch (e) {
      item.status = 'error'
      item.errorMsg = e instanceof Error ? e.message : '解析失败'
    }
    renderBatchList()
  }
}

function renderBatchList() {
  batchMeta.textContent = `共 ${batchQueue.length} 本图书`
  batchList.innerHTML = ''

  for (const item of batchQueue) {
    const div = document.createElement('div')
    div.className = 'batch-item'

    const coverHtml = item.inspected?.info?.coverUrl
      ? `<img src="${item.inspected.info.coverUrl}" alt="封面" />`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z"/></svg>`

    const { dir } = resolveDirectionForBook(item.inspected)
    item.targetDir = dir

    let statusText = '等待中'
    let state = 'ready'
    if (item.status === 'inspecting') {
      statusText = '解析中…'
    } else if (item.status === 'ready') {
      statusText = `转为${targetLabel(dir)}`
    } else if (item.status === 'converting') {
      statusText = `转换中 ${item.progress}%`
      state = 'converting'
    } else if (item.status === 'done') {
      statusText = `已完成 (${targetLabel(dir)})`
      state = 'done'
    } else if (item.status === 'error') {
      statusText = item.errorMsg || '失败'
      state = 'error'
    }

    const title = item.inspected?.info?.title || item.file.name
    const author = item.inspected?.info?.author ? `作者：${item.inspected.info.author} · ` : ''
    const size = formatBytes(item.file.size)

    div.innerHTML = `
      <div class="batch-item-cover">${coverHtml}</div>
      <div class="batch-item-info">
        <div class="batch-item-title" title="${title}">${title}</div>
        <div class="batch-item-meta">${author}${size}</div>
      </div>
      <span class="batch-item-status" data-state="${state}">${statusText}</span>
      <div class="batch-item-action">
        ${
          item.status === 'done' && item.result
            ? `<button class="batch-btn-download" data-id="${item.id}">下载</button>`
            : ''
        }
      </div>
    `

    const dlBtn = div.querySelector<HTMLButtonElement>('.batch-btn-download')
    if (dlBtn) {
      dlBtn.addEventListener('click', () => {
        if (item.result) downloadResult(item.file, item.result, item.targetDir || 't2s')
      })
    }

    batchList.appendChild(div)
  }
}

// ---------------- Conversion Execution ----------------

async function startSingleConvert() {
  if (!currentSingle || isBusy) return
  isBusy = true
  btnConvert.disabled = true
  btnReset.disabled = true
  btnPreviewBefore.disabled = true
  show(errorBox, false)
  show(progressWrap, true)
  progressFill.style.width = '0%'
  progressText.textContent = '准备转换中…'

  const { dir } = resolveDirectionForBook(currentSingle)
  const options: ConvertOptions = {
    direction: dir,
    convertVocab: optVocab.checked,
    convertQuotes: optQuotes.checked,
  }

  try {
    const result = await convertBook(
      currentSingle.file,
      options,
      currentSingle.previewOriginal,
      (pct) => {
        progressFill.style.width = pct + '%'
        progressText.textContent =
          pct < 100 ? `正在转换为${targetLabel(dir)}… ${pct}%` : '正在打包 EPUB…'
      },
    )

    currentResult = result
    currentResultDirection = dir

    show(bookCard, false)
    show(optionsPanel, false)
    show(resultCard, true)

    resultTitle.textContent = result.info.title
    const duration = (result.durationMs / 1000).toFixed(1)
    resultMeta.textContent =
      `已转为${targetLabel(dir)}中文 · 耗时 ${duration}s · 处理 ${result.convertedFiles} 个文件 · 转换 ${result.changedSegments} 处文本`
  } catch (err) {
    show(progressWrap, false)
    errorBox.textContent = err instanceof Error ? err.message : '转换失败'
    show(errorBox, true)
  } finally {
    isBusy = false
    btnConvert.disabled = false
    btnReset.disabled = false
    btnPreviewBefore.disabled = false
  }
}

async function startBatchConvert() {
  if (isBusy || !batchQueue.length) return
  isBusy = true
  btnBatchConvert.disabled = true
  btnBatchReset.disabled = true
  btnBatchClear.disabled = true
  show(batchOverallProgress, true)

  let completedCount = 0
  const total = batchQueue.length

  for (let i = 0; i < batchQueue.length; i++) {
    const item = batchQueue[i]
    if (item.status === 'error' && !item.inspected) continue

    item.status = 'converting'
    item.progress = 0
    renderBatchList()

    const { dir } = resolveDirectionForBook(item.inspected)
    item.targetDir = dir
    const options: ConvertOptions = {
      direction: dir,
      convertVocab: optVocab.checked,
      convertQuotes: optQuotes.checked,
    }

    try {
      const res = await convertBook(
        item.file,
        options,
        item.inspected?.previewOriginal ?? '',
        (pct) => {
          item.progress = pct
          renderBatchList()
        },
      )
      item.result = res
      item.status = 'done'
    } catch (e) {
      item.status = 'error'
      item.errorMsg = e instanceof Error ? e.message : '转换失败'
    }

    completedCount++
    const overallPct = Math.round((completedCount / total) * 100)
    batchProgressFill.style.width = overallPct + '%'
    batchProgressText.textContent = `批量转换进度：${completedCount}/${total} (${overallPct}%)`
    renderBatchList()
  }

  isBusy = false
  btnBatchConvert.disabled = false
  btnBatchReset.disabled = false
  btnBatchClear.disabled = false

  const anySuccess = batchQueue.some((it) => it.status === 'done' && it.result)
  if (anySuccess) {
    show(btnBatchZip, true)
  }
}

// ---------------- Download Helpers ----------------

function downloadResult(file: File, result: ConvertedBook, dir: Direction) {
  const base = file.name.replace(/\.epub$/i, '')
  const url = URL.createObjectURL(result.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${base}.${targetLabel(dir)}.epub`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 15_000)
}

async function downloadBatchZip() {
  const completed = batchQueue.filter((it) => it.status === 'done' && it.result)
  if (!completed.length) return

  btnBatchZip.disabled = true
  btnBatchZip.textContent = '正在打包 ZIP…'

  try {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()

    for (const it of completed) {
      const base = it.file.name.replace(/\.epub$/i, '')
      const filename = `${base}.${targetLabel(it.targetDir || 't2s')}.epub`
      zip.file(filename, it.result!.blob)
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `翻书转换集合_${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 15_000)
  } catch (err) {
    alert(err instanceof Error ? err.message : 'ZIP 打包下载失败')
  } finally {
    btnBatchZip.disabled = false
    btnBatchZip.textContent = '打包下载全部 (.zip)'
  }
}

// ---------------- Preview Modal ----------------

async function openPreview(isConverted: boolean) {
  let orig = ''
  let conv = ''

  if (isConverted && currentResult) {
    orig = currentResult.previewOriginal || '（暂无第 1 章预览文本）'
    conv = currentResult.previewConverted || '（暂无第 1 章预览文本）'
  } else if (currentSingle) {
    orig = currentSingle.previewOriginal || '（暂无第 1 章预览文本）'
    const { dir } = resolveDirectionForBook(currentSingle)
    const options: ConvertOptions = {
      direction: dir,
      convertVocab: optVocab.checked,
      convertQuotes: optQuotes.checked,
    }
    previewConvertedContent.textContent = '正在实时生成译文对比…'
    show(previewModal, true)
    conv = await previewSnippet(orig, options)
  }

  previewOriginalContent.textContent = orig
  previewConvertedContent.textContent = conv
  show(previewModal, true)
}

function closePreview() {
  show(previewModal, false)
}

btnPreviewBefore.addEventListener('click', () => openPreview(false))
btnPreviewAfter.addEventListener('click', () => openPreview(true))
btnModalClose.addEventListener('click', closePreview)
btnModalOk.addEventListener('click', closePreview)
previewModal.addEventListener('click', (e) => {
  if (e.target === previewModal) closePreview()
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !previewModal.classList.contains('hidden')) {
    closePreview()
  }
})

// ---------------- Dropzone & Inputs ----------------

function onFilesSelected(files: FileList | null | undefined) {
  if (!files || !files.length) return
  const validFiles = Array.from(files).filter((f) => /\.epub$/i.test(f.name))
  if (!validFiles.length) {
    alert('请选择后缀为 .epub 的电子书文件')
    return
  }

  if (validFiles.length === 1 && batchQueue.length === 0) {
    void handleSingleFile(validFiles[0])
  } else {
    void handleMultipleFiles(validFiles)
  }
}

dropzone.addEventListener('click', () => fileInput.click())
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    fileInput.click()
  }
})
fileInput.addEventListener('change', () => {
  onFilesSelected(fileInput.files)
})
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault()
  dropzone.classList.add('dragover')
})
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'))
dropzone.addEventListener('drop', (e) => {
  e.preventDefault()
  dropzone.classList.remove('dragover')
  onFilesSelected(e.dataTransfer?.files)
})

// Button listeners
btnConvert.addEventListener('click', () => void startSingleConvert())
btnReset.addEventListener('click', resetAll)
btnAgain.addEventListener('click', resetAll)
btnDownload.addEventListener('click', () => {
  if (currentSingle && currentResult) {
    downloadResult(currentSingle.file, currentResult, currentResultDirection)
  }
})

btnBatchConvert.addEventListener('click', () => void startBatchConvert())
btnBatchZip.addEventListener('click', () => void downloadBatchZip())
btnBatchReset.addEventListener('click', () => fileInput.click())
btnBatchClear.addEventListener('click', resetAll)
