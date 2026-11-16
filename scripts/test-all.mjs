import { DOMParser, NodeFilter } from 'linkedom'
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import * as OpenCC from 'opencc-js'

class XMLSerializer {
  serializeToString(node) {
    return node.toString()
  }
}

globalThis.DOMParser = DOMParser
globalThis.XMLSerializer = XMLSerializer
globalThis.NodeFilter = NodeFilter

const {
  readEpubInfo,
  convertEpub,
  createQuotationConverter,
} = await import('../src/epub.ts')
const { detectScript } = await import('../src/detect.ts')

console.log('=== Flipbook 自动化回归测试 ===\n')

const charT2S = OpenCC.Converter({ from: 'tw', to: 'cn' })
const charS2T = OpenCC.Converter({ from: 'cn', to: 't' })
const vocabT2S = OpenCC.Converter({ from: 'twp', to: 'cn' })
const vocabS2T = OpenCC.Converter({ from: 'cn', to: 'twp' })

// Test 1: 繁体测试书
console.log('--- 测试 1: 繁体测试书检测与转换 ---')
const tcBuf = readFileSync('test/繁體測試書.epub')
const tcFile = new File([tcBuf], '繁體測試書.epub', { type: 'application/epub+zip' })

const { info: tcInfo, sample: tcSample } = await readEpubInfo(tcFile)
console.log('读取成功:', tcInfo.title, '| 作者:', tcInfo.author, '| 章节数:', tcInfo.chapterCount)
console.log('预览片段:\n' + tcInfo.previewSnippet?.trim())

const tcDetect = detectScript(tcSample, charT2S, charS2T)
console.log('繁简检测结果:', tcDetect.source, `(置信度: ${tcDetect.confidence}%)`, '| 包含中文:', tcDetect.hasChinese)
if (tcDetect.source !== 'traditional') {
  throw new Error(`预期繁体，实际得到: ${tcDetect.source}`)
}

// Convert tc to sc with vocab and quotes
const quoteT2S = createQuotationConverter('t2s')
const fullT2S = (t) => quoteT2S(vocabT2S(t))

const tcRes = await convertEpub(
  tcFile,
  fullT2S,
  { direction: 't2s', convertVocab: true, convertQuotes: true }
)

const outTcZip = await JSZip.loadAsync(await tcRes.blob.arrayBuffer())
const outTcNames = Object.keys(outTcZip.files)
if (outTcNames[0] !== 'mimetype') throw new Error('mimetype 不是第一个条目！')
const tcMimetype = await outTcZip.file('mimetype').async('string')
if (tcMimetype !== 'application/epub+zip') throw new Error('mimetype 内容错误！')

const ch1Text = await outTcZip.file('OEBPS/ch1.xhtml').async('string')
const opfText = await outTcZip.file('OEBPS/content.opf').async('string')

console.log('\n[繁转简 校验结果]')
const asserts = [
  ['标题转换: 第一章　头发与皇后', ch1Text.includes('第一章　头发与皇后')],
  ['多音字转换: 头发/皇后', ch1Text.includes('他后来遇见了皇后，她说：“头发干燥是因为内存不足。”')],
  ['地区词转换: 記憶體 -> 内存', ch1Text.includes('内存不足')],
  ['地区词转换: 滑鼠 -> 鼠标', ch1Text.includes('鼠标放在键盘旁边')],
  ['行内元素: 螢幕 -> 屏幕', ch1Text.includes('<em>屏幕</em>')],
  ['直角引号转弯引号: 「」 -> “”', ch1Text.includes('“头发干燥是因为内存不足。”')],
  ['pre 标签保留不转', ch1Text.includes('這段代碼不應轉換：記憶體')],
  ['script 标签保留不转', ch1Text.includes("'不應轉換'")],
  ['OPF 标题转换', opfText.includes('繁体测试书：内存的故乡')],
  ['OPF 语言更新为 zh-CN', opfText.includes('<dc:language>zh-CN</dc:language>')],
]

for (const [name, ok] of asserts) {
  console.log(ok ? '  [PASS]' : '  [FAIL]', name)
  if (!ok) throw new Error(`断言失败: ${name}`)
}

// Test 2: 简体测试书
console.log('\n--- 测试 2: 简体测试书检测与转换 ---')
const scBuf = readFileSync('test/简体测试书.epub')
const scFile = new File([scBuf], '简体测试书.epub', { type: 'application/epub+zip' })

const { info: scInfo, sample: scSample } = await readEpubInfo(scFile)
const scDetect = detectScript(scSample, charT2S, charS2T)
console.log('繁简检测结果:', scDetect.source, `(置信度: ${scDetect.confidence}%)`)
if (scDetect.source !== 'simplified') {
  throw new Error(`预期简体，实际得到: ${scDetect.source}`)
}

const quoteS2T = createQuotationConverter('s2t')
const fullS2T = (t) => quoteS2T(vocabS2T(t))

const scRes = await convertEpub(
  scFile,
  fullS2T,
  { direction: 's2t', convertVocab: true, convertQuotes: true }
)

const outScZip = await JSZip.loadAsync(await scRes.blob.arrayBuffer())
const scCh1 = await outScZip.file('OEBPS/ch1.xhtml').async('string')
const scOpf = await outScZip.file('OEBPS/content.opf').async('string')

console.log('\n[简转繁 校验结果]')
const scAsserts = [
  ['标题转换: 第一章　頭髮與皇后', scCh1.includes('第一章　頭髮與皇后')],
  ['多音字转换: 頭髮/皇后', scCh1.includes('他後來遇見了皇后，她說：「頭髮乾燥是因為記憶體不足。」')],
  ['地区词转换: 内存 -> 記憶體', scCh1.includes('記憶體不足')],
  ['地区词转换: 鼠标 -> 滑鼠', scCh1.includes('滑鼠放在鍵盤旁邊')],
  ['弯引号转直角引号: “” -> 「」', scCh1.includes('「頭髮乾燥是因為記憶體不足。」')],
  ['OPF 语言更新为 zh-TW', scOpf.includes('<dc:language>zh-TW</dc:language>')],
]

for (const [name, ok] of scAsserts) {
  console.log(ok ? '  [PASS]' : '  [FAIL]', name)
  if (!ok) throw new Error(`断言失败: ${name}`)
}

console.log('\n🎉 所有回归测试均已 100% 通过！\n')
