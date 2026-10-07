# 墨读 PaperInk

面向 iPad 和 Apple Pencil 的个人 PDF 文献阅读、手写批注与 DeepSeek AI 提问工具。通过网页运行，可以添加到主屏幕，无需上传 App Store。

## 功能

- **PDF 阅读与本机保存**：原始 PDF、笔迹、图片和聊天记录保存到浏览器 IndexedDB。
- **Apple Pencil 批注**：钢笔、荧光笔、橡皮擦、套索移动、撤销与重做、页面缩放。
- **页面编辑**：插入空白页、删除当前页、恢复误删页面与笔记；文献至少保留一页。
- **插图和分享**：插入图片、套索移动；导出含批注的 PDF，通过系统分享发送到微信等应用。
- **AI 询问画笔**：普通画笔图标右上角带 AI 标识，可连续划线、画圈、跨页标记。绘制标记时不会调用 AI。
- **划线定位**：文字版 PDF 使用文字坐标优先定位划线上方最近一行，排除相邻行和其他栏；发送前显示原文，可以核对、修正。
- **统一提问**：输入提示词后，定位原文与高清局部截图一起交给 DeepSeek。截图通过细框指出目标，避免粗笔迹遮字。扫描页和图表使用局部图片识别。
- **独立聊天窗口**：支持直接打字提问、继续追问；请求失败保留标记和提示词，成功后清除临时 AI 标记。
- **应用访问码**：服务器验证访问码并保存长期 HttpOnly Cookie，无需每次登录 GPT。DeepSeek API Key 保留在服务器。

## 在 iPad 上使用

1. 用 Safari 打开部署网址，首次输入应用访问码。
2. 如果希望从桌面图标打开，先选择「分享 → 添加到主屏幕」，然后从该图标打开，再导入文献。Safari 标签页与主屏幕网页的本机文献库相互独立。
3. 用 Apple Pencil 写画，手指拖动页面。
4. 选择 **AI 询问画笔**，划线或画圈；核对聊天窗口里的原文，输入提示词并点击发送。
5. 定期使用「导出与分享」备份 PDF；清除网站数据会删除本机保存的文献与笔记。

访问状态最长记住一年。换浏览器、切换到独立的主屏幕网页或清除 Cookie 后，需要重新输入访问码。

## 本地开发

需要 Node.js **22.13 或更新版本**（推荐 Node.js 24）及 pnpm **11.25.0**。

```bash
git clone https://github.com/LiFengian/paperink-reader.git
cd paperink-reader
pnpm install --frozen-lockfile
```

把 `.env.example` 复制为 `.env.local`，填写自己的配置：

```dotenv
DEEPSEEK_API_KEY=你的DeepSeek密钥
PAPERINK_ACCESS_CODE=你自己生成的长随机访问码
```

启动开发服务器：

```bash
pnpm dev
```

打开终端显示的网址（通常为 `http://127.0.0.1:5173`），输入 `.env.local` 中的访问码。

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

`pnpm test` 覆盖划线偏移、密集相邻行、双栏、部分单词、圆圈、上下标和无文字层的处理。

## 部署

项目使用 React、TypeScript、Vinext / Vite 和 Cloudflare Workers。AI 代理需要服务端运行，不能仅部署到 GitHub Pages。

### Sites

通过 Sites 发布源码和构建产物，在站点运行时配置以下**密钥**：

- `DEEPSEEK_API_KEY`
- `PAPERINK_ACCESS_CODE`

`.openai/hosting.json` 中的 `project_id` 属于原站点。为其他账号创建新 Sites 项目时，应使用新项目返回的 ID。

### Cloudflare Workers

```bash
pnpm build
pnpm exec wrangler deploy --config dist/server/wrangler.json
pnpm exec wrangler secret put DEEPSEEK_API_KEY --config dist/server/wrangler.json
pnpm exec wrangler secret put PAPERINK_ACCESS_CODE --config dist/server/wrangler.json
```

根据自己的 Cloudflare 账号调整 Worker 名称；部署后的访问码由自己设置。

## 数据与配置

源码仓库不包含真实 API Key、应用访问码、用户 PDF 或本机笔记。`.env*`、`.dev.vars*`、构建输出和本地运行状态均被 Git 忽略，只有不含密钥值的 `.env.example` 会提交。

原始 PDF 不上传到服务端。点击发送后，服务器会把定位原文、标记附近的截图、提示词和最近聊天上下文转发给 DeepSeek。

文字坐标可以减少错行；扫描页、特殊排版、图表和公式仍需要图片识别，发送前可以核对定位结果。

## 代码结构

| 路径 | 内容 |
| --- | --- |
| `app/page.tsx` | 文献库、阅读器、批注工具、AI 画笔和聊天界面 |
| `app/api/access/route.ts` | 访问码验证与 Cookie |
| `app/api/ai/route.ts` | DeepSeek 服务端代理 |
| `lib/ai-selection.ts` | 按 PDF 文字坐标定位划线、圆圈内容 |
| `lib/ai-context.ts` | 生成干净的局部截图与定位原文 |
| `lib/local-store.ts` | IndexedDB 本机存储 |
| `lib/export-pdf.ts` | 导出带批注的 PDF |
| `tests/ai-selection.test.mjs` | 定位回归测试 |

## 实现与参考

- [Mozilla PDF.js](https://github.com/mozilla/pdf.js)：PDF 渲染与文字提取。
- [pdf-lib](https://github.com/Hopding/pdf-lib)：导出 PDF 与写入笔迹。
- [Inko](https://github.com/sinabin/inko-sdk)：可编辑 PDF 批注层的设计参考。
- [pdfpal](https://github.com/andrepaim/pdfpal)：文献与 AI 聊天并排的流程参考。

批注层采用 SVG。模板和第三方组件的许可保留在 `build/sites-vite-plugin.LICENSE`、`vendor/` 及相关依赖中。
