import './style.css'
import * as OpenCC from 'opencc-js'
import { readEpubInfo, convertEpub, type EpubInfo, type ConvertResult, type TextConverter } from './epub'
import { detectScript, type ScriptDetection } from './detect'

type Direction = 't2s' | 's2t'
type Mode = 'auto' | Direction

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const dropzone = $<HTMLElement>('dropzone')
const fileInput = $<HTMLInputElement>('file-input')
const bookCard = $<HTMLElement>('book-card')
const resultCard = $<HTMLElement>('result-card')
const bookTitle = $<HTMLDivElement>('book-title')
const bookMeta = $<HTMLDivElement>('book-meta')
const optVocab = $<HTMLInputElement>('opt-vocab')
const btnConvert = $<HTMLButtonElement>('btn-convert')
const btnReset = $<HTMLButtonElement>('btn-reset')
const btnDownload = $<HTMLButtonElement>('btn-download')
const btnAgain = $<HTMLButtonElement>('btn-again')
const progressWrap = $<HTMLDivElement>('progress-wrap')
const progressFill = $<HTMLDivElement>('progress-fill')
const progressText = $<HTMLDivElement>('progress-text')
const errorBox = $<HTMLDivElement>('error')
const resultTitle = $<HTMLDivElement>('result-title')
const resultMeta = $<HTMLDivElement>('result-meta')
const detectLine = $<HTMLDivElement>('detect-line')
const detectText = $<HTMLDivElement>('detect-text')
const vocabHint = $<HTMLSpanElement>('vocab-hint')

const charT2S = OpenCC.Converter({ from: 'tw', to: 'cn' })
const charS2T = OpenCC.Converter({ from: 'cn', to: 't' })
const converters: Record<Direction, { plain: TextConverter; vocab: TextConverter }> = {
  t2s: { plain: charT2S, vocab: OpenCC.Converter({ from: 'twp', to: 'cn' }) },
  s2t: { plain: charS2T, vocab: OpenCC.Converter({ from: 'cn', to: 'twp' }) },
}

let currentFile: File | null = null
let detection: ScriptDetection | null = null
let result: ConvertResult | null = null
let resultDirection: Direction = 't2s'
let busy = false

const targetLabel = (dir: Direction) => (dir === 't2s' ? '简体' : '繁体')

function show(el: HTMLElement, visible: boolean) {
  el.classList.toggle('hidden', !visible)
}

function showError(msg: string) {
  errorBox.textContent = msg
  show(errorBox, true)
}

function metaText(info: EpubInfo): string {
  const parts = [info.author && `作者：${info.author}`, `${info.chapterCount} 个章节`]
  return parts.filter(Boolean).join(' · ')
}

function currentMode(): Mode {
  const checked = document.querySelector<HTMLInputElement>('input[name="direction"]:checked')
  return (checked?.value as Mode) ?? 'auto'
}

function resolveDirection(): { dir: Direction; note: string; warn: boolean } {
  const mode = currentMode()
  if (mode !== 'auto') {
    return { dir: mode, note: `手动指定：将转换为${targetLabel(mode)}中文`, warn: false }
  }
  if (!detection || detection.source === 'unknown') {
    return { dir: 't2s', note: '无法识别文字类型，默认按繁体 → 简体处理', warn: true }
  }
  const dir: Direction = detection.source === 'traditional' ? 't2s' : 's2t'
  const sourceLabel = detection.source === 'traditional' ? '繁体' : '简体'
  return {
    dir,
    note: `已识别${sourceLabel}中文（置信度 ${detection.confidence}%）· 将转换为${targetLabel(dir)}`,
    warn: false,
  }
}

function updateDirectionUI() {
  const { dir, note, warn } = resolveDirection()
  btnConvert.textContent = `转换为${targetLabel(dir)}`
  detectText.textContent = note
  detectLine.dataset.state = warn ? 'warn' : 'ok'
  vocabHint.textContent =
    dir === 't2s' ? '記憶體 → 内存 · 滑鼠 → 鼠标' : '内存 → 記憶體 · 鼠标 → 滑鼠'
}

function resetAll() {
  currentFile = null
  detection = null
  result = null
  fileInput.value = ''
  show(bookCard, false)
  show(resultCard, false)
  show(progressWrap, false)
  show(errorBox, false)
  show(dropzone, true)
  btnConvert.disabled = false
}

async function acceptFile(file: File) {
  if (busy) return
  resetAll()
  if (!/\.epub$/i.test(file.name)) {
    bookTitle.textContent = file.name
    bookMeta.textContent = ''
    btnConvert.disabled = true
    show(dropzone, false)
    show(bookCard, true)
    showError('请选择 .epub 格式的文件')
    return
  }
  try {
    const { info, sample } = await readEpubInfo(file)
    detection = detectScript(sample, charT2S, charS2T)
    currentFile = file
    bookTitle.textContent = info.title
    bookMeta.textContent = `${file.name} · ${metaText(info)}`
    show(dropzone, false)
    show(bookCard, true)
    updateDirectionUI()
  } catch (e) {
    bookTitle.textContent = file.name
    bookMeta.textContent = ''
    btnConvert.disabled = true
    show(dropzone, false)
    show(bookCard, true)
    showError(e instanceof Error ? e.message : '文件读取失败')
  }
}

async function startConvert() {
  if (!currentFile || busy) return
  busy = true
  btnConvert.disabled = true
  btnReset.disabled = true
  show(errorBox, false)
  show(progressWrap, true)
  progressFill.style.width = '0%'
  progressText.textContent = '准备中…'

  const { dir } = resolveDirection()
  const converter = converters[dir][optVocab.checked ? 'vocab' : 'plain']
  try {
    result = await convertEpub(currentFile, converter, (done, total) => {
      const pct = Math.min(100, Math.round((done / total) * 100))
      progressFill.style.width = pct + '%'
      progressText.textContent = pct < 100 ? `正在转换为${targetLabel(dir)}… ${pct}%` : '打包完成'
    })
    resultDirection = dir
    resultTitle.textContent = result.info.title
    resultMeta.textContent =
      `已转换为${targetLabel(dir)}中文 · 处理 ${result.convertedFiles} 个文件 · 转换 ${result.changedSegments} 处文本`
    show(bookCard, false)
    show(resultCard, true)
  } catch (e) {
    show(progressWrap, false)
    showError(e instanceof Error ? e.message : '转换失败，请检查文件是否为有效的 EPUB')
  } finally {
    busy = false
    btnConvert.disabled = false
    btnReset.disabled = false
  }
}

function download() {
  if (!result || !currentFile) return
  const base = currentFile.name.replace(/\.epub$/i, '')
  const url = URL.createObjectURL(result.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${base}.${targetLabel(resultDirection)}.epub`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

dropzone.addEventListener('click', () => fileInput.click())
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    fileInput.click()
  }
})
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0]
  if (f) void acceptFile(f)
})
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault()
  dropzone.classList.add('dragover')
})
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'))
dropzone.addEventListener('drop', (e) => {
  e.preventDefault()
  dropzone.classList.remove('dragover')
  const f = e.dataTransfer?.files[0]
  if (f) void acceptFile(f)
})
document.querySelectorAll<HTMLInputElement>('input[name="direction"]').forEach((el) => {
  el.addEventListener('change', updateDirectionUI)
})
btnConvert.addEventListener('click', () => void startConvert())
btnReset.addEventListener('click', resetAll)
btnAgain.addEventListener('click', resetAll)
btnDownload.addEventListener('click', download)