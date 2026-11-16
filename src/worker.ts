import * as OpenCC from 'opencc-js'
import {
  readEpubInfo,
  convertEpub,
  createQuotationConverter,
  type ConvertOptions,
  type TextConverter,
} from './epub'
import { detectScript, type ScriptDetection } from './detect'

const charT2S = OpenCC.Converter({ from: 'tw', to: 'cn' })
const charS2T = OpenCC.Converter({ from: 'cn', to: 't' })
const vocabT2S = OpenCC.Converter({ from: 'twp', to: 'cn' })
const vocabS2T = OpenCC.Converter({ from: 'cn', to: 'twp' })

function getConverter(options: ConvertOptions): TextConverter {
  const isT2S = options.direction === 't2s'
  let baseConverter: TextConverter
  if (isT2S) {
    baseConverter = options.convertVocab ? vocabT2S : charT2S
  } else {
    baseConverter = options.convertVocab ? vocabS2T : charS2T
  }

  if (options.convertQuotes) {
    const quoteConverter = createQuotationConverter(options.direction)
    return (text: string) => quoteConverter(baseConverter(text))
  }
  return baseConverter
}

self.onmessage = async (e: MessageEvent) => {
  const data = e.data
  const { type, id } = data

  if (type === 'inspect') {
    try {
      const file: File = data.file
      const { info, sample } = await readEpubInfo(file)
      const detection: ScriptDetection = detectScript(sample, charT2S, charS2T)
      self.postMessage({
        type: 'inspected',
        id,
        info,
        detection,
        previewOriginal: info.previewSnippet ?? '',
      })
    } catch (err) {
      self.postMessage({
        type: 'error',
        id,
        message: err instanceof Error ? err.message : '文件解析失败',
      })
    }
  } else if (type === 'convert') {
    try {
      const file: File = data.file
      const options: ConvertOptions = data.options
      const previewOriginal: string = data.previewOriginal ?? ''
      const converter = getConverter(options)

      const result = await convertEpub(file, converter, options, (done, total) => {
        self.postMessage({
          type: 'progress',
          id,
          done,
          total,
        })
      })

      const previewConverted = previewOriginal ? converter(previewOriginal) : ''

      self.postMessage({
        type: 'converted',
        id,
        blob: result.blob,
        info: result.info,
        convertedFiles: result.convertedFiles,
        changedSegments: result.changedSegments,
        previewOriginal,
        previewConverted,
      })
    } catch (err) {
      self.postMessage({
        type: 'error',
        id,
        message: err instanceof Error ? err.message : '转换失败，请检查文件是否为有效的 EPUB',
      })
    }
  } else if (type === 'preview') {
    try {
      const text: string = data.text ?? ''
      const options: ConvertOptions = data.options
      const converter = getConverter(options)
      self.postMessage({
        type: 'previewed',
        id,
        converted: converter(text),
      })
    } catch (err) {
      self.postMessage({
        type: 'error',
        id,
        message: err instanceof Error ? err.message : '预览生成失败',
      })
    }
  }
}
