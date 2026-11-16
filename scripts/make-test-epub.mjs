import JSZip from 'jszip'
import { writeFileSync, mkdirSync } from 'node:fs'

function makeBook({ file, title, author, lang, ch1, ch2, nav1, nav2, cssComment }) {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>${lang}</dc:language>
    <dc:identifier id="uid">test-001</dc:identifier>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine toc="ncx"><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`)
  zip.file('OEBPS/ch1.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title><link rel="stylesheet" href="style.css"/></head>
<body>${ch1}</body></html>`)
  zip.file('OEBPS/text/ch2.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head>
<body>${ch2}</body></html>`)
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <docTitle><text>${nav1}</text></docTitle>
  <navMap>
    <navPoint id="n1"><navLabel><text>${nav1}</text></navLabel><content src="ch1.xhtml"/></navPoint>
    <navPoint id="n2"><navLabel><text>${nav2}</text></navLabel><content src="text/ch2.xhtml"/></navPoint>
  </navMap>
</ncx>`)
  zip.file('OEBPS/style.css', `body { font-family: serif; } /* ${cssComment} */`)
  return zip.generateAsync({ type: 'nodebuffer' }).then((buf) => {
    writeFileSync(file, buf)
    console.log('written', file, buf.length, 'bytes')
  })
}

mkdirSync('test', { recursive: true })

await makeBook({
  file: 'test/繁體測試書.epub',
  title: '繁體測試書：記憶體的故鄉',
  author: '測試作者',
  lang: 'zh-TW',
  ch1: `<h1>第一章　頭髮與皇后</h1>
<p>他後來遇見了皇后，她說：「頭發幹燥是因為記憶體不足。」</p>
<p>滑鼠放在鍵盤旁邊，<em>螢幕</em>上顯示著繁體字。</p>
<pre>這段代碼不應轉換：記憶體</pre>
<script>var s = '不應轉換';</script>`,
  ch2: `<h1>第二章　軟體與硬體</h1><p>這是一段用於測試離線轉換的文字，包含各種繁體詞彙：資料庫、網路、印表機。</p>`,
  nav1: '第一章　頭髮與皇后',
  nav2: '第二章　軟體與硬體',
  cssComment: '繁體註釋不應被破壞',
})

await makeBook({
  file: 'test/简体测试书.epub',
  title: '简体测试书：内存的故乡',
  author: '测试作者',
  lang: 'zh-CN',
  ch1: `<h1>第一章　头发与皇后</h1>
<p>他后来遇见了皇后，她说：「头发干燥是因为内存不足。」</p>
<p>鼠标放在键盘旁边，<em>屏幕</em>上显示着简体字。</p>
<pre>这段代码不应转换：内存</pre>
<script>var s = '不应转换';</script>`,
  ch2: `<h1>第二章　软件与硬件</h1><p>这是一段用于测试离线转换的文字，包含各种简体词汇：数据库、网络、打印机。</p>`,
  nav1: '第一章　头发与皇后',
  nav2: '第二章　软件与硬件',
  cssComment: '简体注释不应被破坏',
})