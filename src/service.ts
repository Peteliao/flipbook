import type { EpubInfo, ConvertOptions, TextConverter } from './epub'
import type { ScriptDetection } from './detect'

export interface InspectedBook {
  file: File
  id: string
  info: EpubInfo
  detection: ScriptDetection
  previewOriginal: string
}

export interface ConvertedBook {
  file: File
  id: string
  blob: Blob
  info: EpubInfo
  convertedFiles: number
  changedSegments: number
  previewOriginal?: string
  previewConverted?: string
  durationMs: number
}

type ProgressCallback = (pct: number) => void

interface PendingRequest {
  resolve: (val: any) => void
  reject: (err: any) => void
  onProgress?: ProgressCallback
  startTime: number
}

const pendingRequests = new Map<string, PendingRequest>()
let worker: Worker | null = null
let workerFailed = false

function getWorker(): Worker | null {
  if (workerFailed) return null
  if (!worker) {
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent) => {
        const { type, id } = e.data
        const req = pendingRequests.get(id)
        if (!req) return

        if (type === 'progress') {
          const { done, total } = e.data
          const pct = Math.min(100, Math.round((done / total) * 100))
          req.onProgress?.(pct)
        } else if (type === 'inspected') {
          pendingRequests.delete(id)
          req.resolve(e.data)
        } else if (type === 'previewed') {
          pendingRequests.delete(id)
          req.resolve(e.data.converted)
        } else if (type === 'converted') {
          pendingRequests.delete(id)
          const durationMs = Date.now() - req.startTime
          req.resolve({ ...e.data, durationMs })
        } else if (type === 'error') {
          pendingRequests.delete(id)
          req.reject(new Error(e.data.message || '操作失败'))
        }
      }
      worker.onerror = (err) => {
        console.warn('Worker runtime error:', err)
      }
    } catch (err) {
      console.warn('Worker initialization failed, fallback to main thread:', err)
      workerFailed = true
      return null
    }
  }
  return worker
}

let nextId = 1
const genId = () => `req_${Date.now()}_${nextId++}`

// Fallback runner if Worker is unavailable
async function runOnMainThread<T>(action: (helpers: any) => Promise<T>): Promise<T> {
  const OpenCC = await import('opencc-js')
  const epub = await import('./epub')
  const detect = await import('./detect')

  const charT2S = OpenCC.Converter({ from: 'tw', to: 'cn' })
  const charS2T = OpenCC.Converter({ from: 'cn', to: 't' })
  const vocabT2S = OpenCC.Converter({ from: 'twp', to: 'cn' })
  const vocabS2T = OpenCC.Converter({ from: 'cn', to: 'twp' })

  const getConverter = (options: ConvertOptions): TextConverter => {
    const isT2S = options.direction === 't2s'
    const base = isT2S
      ? options.convertVocab
        ? vocabT2S
        : charT2S
      : options.convertVocab
        ? vocabS2T
        : charS2T
    if (options.convertQuotes) {
      const q = epub.createQuotationConverter(options.direction)
      return (text: string) => q(base(text))
    }
    return base
  }

  return action({ OpenCC, epub, detect, charT2S, charS2T, getConverter })
}

export async function inspectFile(file: File): Promise<InspectedBook> {
  const id = genId()
  const w = getWorker()

  if (w) {
    return new Promise<InspectedBook>((resolve, reject) => {
      pendingRequests.set(id, {
        resolve: (data) => resolve({ file, id, ...data }),
        reject,
        startTime: Date.now(),
      })
      w.postMessage({ type: 'inspect', id, file })
    })
  }

  return runOnMainThread(async ({ epub, detect, charT2S, charS2T }) => {
    const { info, sample } = await epub.readEpubInfo(file)
    const detection = detect.detectScript(sample, charT2S, charS2T)
    return {
      file,
      id,
      info,
      detection,
      previewOriginal: info.previewSnippet ?? '',
    }
  })
}

export async function previewSnippet(
  text: string,
  options: ConvertOptions,
): Promise<string> {
  const id = genId()
  const w = getWorker()

  if (w) {
    return new Promise<string>((resolve, reject) => {
      pendingRequests.set(id, {
        resolve,
        reject,
        startTime: Date.now(),
      })
      w.postMessage({ type: 'preview', id, text, options })
    })
  }

  return runOnMainThread(async ({ getConverter }) => {
    const converter = getConverter(options)
    return converter(text)
  })
}

export async function convertBook(
  file: File,
  options: ConvertOptions,
  previewOriginal = '',
  onProgress?: ProgressCallback,
): Promise<ConvertedBook> {
  const id = genId()
  const w = getWorker()

  if (w) {
    return new Promise<ConvertedBook>((resolve, reject) => {
      pendingRequests.set(id, {
        resolve: (data) => resolve({ file, id, ...data }),
        reject,
        onProgress,
        startTime: Date.now(),
      })
      w.postMessage({ type: 'convert', id, file, options, previewOriginal })
    })
  }

  return runOnMainThread(async ({ epub, getConverter }) => {
    const startTime = Date.now()
    const converter = getConverter(options)
    const res = await epub.convertEpub(file, converter, options, (done: number, total: number) => {
      const pct = Math.min(100, Math.round((done / total) * 100))
      onProgress?.(pct)
    })
    const previewConverted = previewOriginal ? converter(previewOriginal) : ''
    return {
      file,
      id,
      blob: res.blob,
      info: res.info,
      convertedFiles: res.convertedFiles,
      changedSegments: res.changedSegments,
      previewOriginal,
      previewConverted,
      durationMs: Date.now() - startTime,
    }
  })
}
