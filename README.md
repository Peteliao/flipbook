# 翻书 Flipbook

纯前端的 EPUB 电子书繁简双向转换工具。所有处理都在浏览器本地完成，文件不会上传到任何服务器。

**在线体验**：<https://peteliao.github.io/flipbook/>

## 功能

- 拖拽或选择 `.epub` 文件，自动读取书名、作者、章节数
- **自动识别**文字类型：检测正文以繁体还是简体为主，转换为对应的另一种
- 也可手动指定方向：繁 → 简 / 简 → 繁
- 基于 [OpenCC](https://github.com/nk2028/opencc-js)，正确处理一简对多繁（如「頭髮／皇后」→「头发／皇后」）
- 可选地区词汇转换：
  - 繁 → 简：記憶體 → 内存、滑鼠 → 鼠标
  - 简 → 繁：内存 → 記憶體、鼠标 → 滑鼠
- 转换正文、目录（NCX / EPUB3 nav）和 OPF 元数据（书名、作者等）
- 保留原书排版、样式、图片与章节结构；跳过 `script` / `style` / `pre` / `code` 及 `translate="no"` 内容
- 输出标准 EPUB（`mimetype` 为首个非压缩条目），下载为 `原书名.简体.epub` / `原书名.繁体.epub`
- 界面跟随系统浅色 / 深色模式

## 快速开始

```bash
npm install
npm run dev      # 开发服务器 http://127.0.0.1:5173
npm run build    # 产物输出到 dist/，可部署到任意静态托管
```

## 测试

```bash
node scripts/make-test-epub.mjs             # 生成繁体 / 简体两本测试书到 test/
node scripts/verify-output.mjs t2s <b64>    # 校验繁→简输出
node scripts/verify-output.mjs s2t <b64>    # 校验简→繁输出
```

浏览器中将下载结果转存为 base64 文件后传给校验脚本。

## 技术说明

- `src/epub.ts`：JSZip 解包 → 通过 `META-INF/container.xml` 定位 OPF → 按 manifest 媒体类型转换 XHTML / NCX 文本节点 → 重新打包
- `src/detect.ts`：对书脊前几章的文本采样，逐字判断该字在 OpenCC 繁简映射中是否为单向字符（仅繁体或仅简体），按出现次数统计并给出置信度；信号不足时回退为繁 → 简
- `src/main.ts`：UI 状态管理、方向解析（自动 / 手动）、OpenCC 转换器选择（`tw`/`twp` ↔ `cn`）
- 局限：文本被行内标签（如 `<em>`）拆分时，跨标签的词组可能无法整体匹配转换；不支持 DRM 加密的 EPUB