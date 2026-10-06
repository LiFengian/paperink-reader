# 墨读 PaperInk

为 iPad 和 Apple Pencil 设计的个人 PDF 阅读工具。网页形式运行，无需上架 App Store。

## 功能

- 在浏览器本地导入和保存 PDF、手写笔迹、插入的图片与聊天记录（IndexedDB）。
- Apple Pencil 钢笔、荧光笔、橡皮擦、套索移动、撤销重做、缩放、插入空白页和图片。
- 用「圈选问 AI」圈住 PDF 内容；文字版 PDF 在设备内提取文字，扫描页的局部截图发送到 DeepSeek 做识别。识别出的文字可修改，再补充问题并发送。
- 独立聊天栏；可导出含批注的 PDF，用 iPad 系统分享发送到微信等应用。
- 私有 Sites 站点作为网页与 DeepSeek API 中转。原 PDF 和笔记不会上传到站点。

## 使用

1. 在 iPad Safari 打开私有站点网址，并登录可访问该站点的账号。
2. 如果希望像 App 一样使用，先在 Safari 分享菜单中选择「添加到主屏幕」，然后从主屏幕打开墨读并导入 PDF。主屏幕网页与 Safari 标签页的本地存储相互独立。
3. 用 Apple Pencil 写画；手指拖动页面。点击 ✦ 工具圈选段落并向 AI 提问。
4. 定期点击「导出与分享」保存带批注的 PDF。清除 Safari 的网站数据会删除本机文献和笔记。

## 开发

需要 Node.js 22 和 pnpm 11。将 `DEEPSEEK_API_KEY` 配置为 Sites 运行时**密钥**；不要写入源码或提交记录。

```text
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
node scripts/run-framework.mjs dev
node scripts/run-framework.mjs build
```

本地环境若要测试 AI 路由，可在未跟踪的 `.env.local` 中配置密钥。部署环境通过 Sites 的运行时密钥配置。

## 实现参考

- [Mozilla PDF.js](https://github.com/mozilla/pdf.js)：PDF 渲染和文字提取。
- [Inko](https://github.com/sinabin/inko-sdk)：PDF 上的可编辑批注层设计参考。
- [pdfpal](https://github.com/andrepaim/pdfpal)：文献与 AI 聊天并排的阅读流程参考。

源码没有复制以上项目的实现。批注使用 SVG 覆盖层，并通过 pdf-lib 写入分享用 PDF。
