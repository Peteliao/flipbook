import JSZip from 'jszip'
import { readFileSync, writeFileSync } from 'node:fs'

const [dir = 't2s', b64File = 'test/output.b64'] = process.argv.slice(2)
if (!['t2s', 's2t'].includes(dir)) {
  console.error('usage: node scripts/verify-output.mjs <t2s|s2t> [b64file]')
  process.exit(2)
}

const buf = Buffer.from(readFileSync(b64File, 'utf8').trim(), 'base64')
writeFileSync(`test/verify-${dir}.epub`, buf)
const zip = await JSZip.loadAsync(buf)

const names = Object.keys(zip.files)
const ch1 = await zip.file('OEBPS/ch1.xhtml').async('string')
const ch2 = await zip.file('OEBPS/text/ch2.xhtml').async('string')
const opf = await zip.file('OEBPS/content.opf').async('string')
const ncx = await zip.file('OEBPS/toc.ncx').async('string')
const css = await zip.file('OEBPS/style.css').async('string')

const checks = []
const check = (name, ok) => { checks.push([name, ok]); console.log(ok ? 'PASS' : 'FAIL', name) }
const expect = {
  t2s: {
    ch1: [
      ['ch1 title converted', '第一章　头发与皇后'],
      ['one-to-many chars correct', '他后来遇见了皇后，她说：「头发干燥是因为内存不足。」'],
      ['vocab 記憶體→内存', '内存不足'],
      ['vocab 滑鼠→鼠标', '鼠标放在键盘旁边'],
      ['inline em converted', '<em>屏幕</em>'],
      ['pre NOT converted', '這段代碼不應轉換：記憶體'],
      ['script NOT converted', "'不應轉換'"],
    ],
    ch2: [['ch2 converted', '软件与硬件'], ['ch2 vocab', '数据库、网络、打印机']],
    opf: [['opf title', '繁体测试书：内存的故乡'], ['opf creator', '测试作者'], ['opf lang preserved', 'zh-TW']],
    ncx: [['ncx labels', '第一章　头发与皇后'], ['ncx src preserved', 'src="text/ch2.xhtml"']],
    css: ['繁體註釋不應被破壞'],
  },
  s2t: {
    ch1: [
      ['ch1 title converted', '第一章　頭髮與皇后'],
      ['one-to-many chars correct', '他後來遇見了皇后，她說：「頭髮乾燥是因為記憶體不足。」'],
      ['vocab 内存→記憶體', '記憶體不足'],
      ['vocab 鼠标→滑鼠', '滑鼠放在鍵盤旁邊'],
      ['inline em converted', '<em>螢幕</em>'],
      ['pre NOT converted', '这段代码不应转换：内存'],
      ['script NOT converted', "'不应转换'"],
    ],
    ch2: [['ch2 converted', '軟體與硬體'], ['ch2 vocab', '資料庫、網路、印表機']],
    opf: [['opf title', '簡體測試書：記憶體的故鄉'], ['opf creator', '測試作者'], ['opf lang preserved', 'zh-CN']],
    ncx: [['ncx labels', '第一章　頭髮與皇后'], ['ncx src preserved', 'src="text/ch2.xhtml"']],
    css: ['简体注释不应被破坏'],
  },
}[dir]

console.log(`--- direction ${dir}: ch1.xhtml ---\n${ch1}\n`)
check('mimetype is first entry', names[0] === 'mimetype')
check('mimetype content', (await zip.file('mimetype').async('string')) === 'application/epub+zip')
for (const [name, needle] of expect.ch1) check(name, ch1.includes(needle))
for (const [name, needle] of expect.ch2) check(name, ch2.includes(needle))
for (const [name, needle] of expect.opf) check(name, opf.includes(needle))
for (const [name, needle] of expect.ncx) check(name, ncx.includes(needle))
check('css untouched', css.includes(expect.css[0]))

const failed = checks.filter(([, ok]) => !ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length ? 1 : 0)