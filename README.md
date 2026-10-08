# 墨读 PaperInk

面向 iPad 和 Apple Pencil 的个人 PDF 文献阅读、手写批注与 DeepSeek AI 提问工具。通过网页运行，可以添加到主屏幕，无需上传 App Store。

## 功能

- **PDF 阅读与本机保存**：原始 PDF、笔迹、图片和聊天记录保存到浏览器 IndexedDB。
- **Apple Pencil 批注**：钢笔、荧光笔、橡皮擦、套索移动、撤销与重做、页面缩放。
- **页面编辑**：插入空白页、删除当前页、恢复误删页面与笔记；文献至少保留一页。
- **可收起便签**：在页面放置标记，点标记打开便签；支持打字和 Apple Pencil 手写，收起后再点即可查看，套索可移动标记。
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

## 个人离线版（推荐自己在 iPad 上使用）

免费安装入口：<https://lifengian.github.io/paperink-reader/>。

1. 用 iPad Safari 打开入口，选择“分享 → 添加到主屏幕”。
2. 从主屏幕的“墨读”图标打开，等待“离线与备份”中显示“离线资源已就绪”。字体、文字映射、图片解码器和 PDF Worker 都会完整缓存。
3. 在“离线与备份 → DeepSeek 设置”填写自己的 API Key。Key 仅保存在当前设备，不写入源码、服务器、离线资源缓存或文献库备份。
4. 导入 PDF，或恢复旧入口导出的 `.paperink` 完整备份。

日常从主屏幕打开后，即使托管入口暂时无法访问，也能读 PDF、手写批注（书写时锁定页面、忽略手掌；移动请先选手掌工具）、套索整理、插入/删除页、插入图片和导出 PDF；会重新打开上次的文献。AI 画笔和聊天直接请求 `https://api.deepseek.com/chat/completions`，需要可访问 DeepSeek 的网络，按你的 API 账户计费，不经过 ChatGPT 或本站后端。

首次下载和更新需要能访问安装入口。如果所在地网络无法打开 GitHub Pages，首次安装可能需要临时使用 VPN；下载完整后，日常阅读无需 VPN。缓存被清除后需要重新下载。代码可以部署到任意 HTTPS 静态托管，入口地址与 Service Worker 范围采用相对路径，支持子目录。

### 拖动、缩放和橡皮

选择手掌工具后，可单指拖动并惯性滑动，双指捏合以手指中点为中心缩放。缩放按钮也会平滑预览。拖动与缩放期间保持全页预览，停下后用可见区域的高清图替换；写画模式保持页面锁定和手掌屏蔽。

橡皮支持“整笔”和“局部”：整笔模式删除触碰到的笔画；局部模式按住拖动，仅剪去橡皮扫过的部分，剩余笔迹仍可编辑。一整次擦除或套索移动对应一次撤销；橡皮大小可调整。橡皮保留插入的图片，图片可用套索选中后点击“删除选中对象”。

### 便签笔记（0.4.0）

选择工具栏的便签图标，点一下页面放置标记。便签支持“手写”和“文字”：手写区使用 Apple Pencil，带局部橡皮及撤销/重做；文字区可输入多行笔记。点击“收起便签”后只留下标记，再点标记就能查看和继续编辑。手掌不会在手写区触发滚动。

便签自动保存在当前设备，离线重开、翻页后仍保留。套索可以移动标记；删除便签或所在页面后可用阅读器的撤销恢复。`.paperink` 完整备份包含可编辑的文字、手写笔迹和标记位置。

导出 PDF 保留便签标记和标准文字批注，含手写内容的便签另附手写页，并在文字批注中标注附页页码。文字批注能否弹出取决于查看 PDF 的软件；需要在墨读中继续编辑时，请使用完整备份。

### 0.3.1 书写性能修复

实时笔迹在可见区域的独立画布上追加绘制，已保存笔迹复用渲染结果。套索拖动只移动预览，松手后一次提交坐标；橡皮先排除扫过范围之外的对象。后台全文准备在书写时暂停，提问时继续准备完整文字。PDF 高清渲染结束后释放临时画布。

本地保存改为只写变动的笔迹和页面记录。升级保留原有 PDF、笔迹、图片、页面和聊天；完整备份格式继续兼容。测试覆盖旧数据库升级、连续保存、事务失败回滚、重开恢复、备份恢复和文献删除。

桌面浏览器以 4 倍 CPU 限速，加载 1,800 条笔迹（144,000 个点）后连续写 8 笔：数据库写入的同步耗时从每笔约 210 毫秒降至 1 毫秒以内，修复后这一测试没有超过 50 毫秒的长任务。此结果是模拟压测，iPad 手感仍需实机验证。

### 全文与 AI

打开文献后，在设备本地准备原始 PDF 的全部文字，AI 面板显示准备进度和无文字层的页数。输入问题后，把全文、近期对话、定位原文和标记截图一起发送给 DeepSeek；也可使用“生成全文导读”。原始 PDF 文件继续保存在 iPad。

全文页码使用原始 PDF 页码，标记同时记录阅读器页码和原始页码。新增空白页或删除阅读器页面不会混淆来源。图表视觉关系、没有文字层的扫描页仍需通过标记截图询问；不会声称已读取这些页面的图像。超出全文字符预算时会提示拆分文献，不会静默截断。

默认使用 `deepseek-flash`、开启深度思考（`high`）。在“离线与备份”可选择 Pro，以及快速、深度或更深入思考。Pro 不直接支持图片，所以含截图时先由 Flash 转写，再将转写、全文和问题交给 Pro。只展示模型最终答案，不展示推理草稿。

设置与 Key 保存在本机，不包含在文献备份中。提问时全文输入和推理输出均按你的 DeepSeek API 账户计费；Pro 和更深入思考通常需要更多时间和费用。当前能力及计费以 [DeepSeek 模型说明](https://api-docs.deepseek.com/quick_start/pricing/) 和 [思考模式说明](https://api-docs.deepseek.com/guides/thinking_mode/) 为准。

### 从旧网站迁移

在原先使用的 Safari 标签页或主屏幕版本中打开旧站点，进入“完整备份 → 生成完整备份 → 保存或分享备份”，把 `.paperink` 文件存到 iPad“文件”。在新主屏幕版“离线与备份 → 恢复备份”选择它。

完整备份包含原始 PDF、可编辑笔迹、图片、空白页/删除页状态、当前页及聊天记录。恢复前验证格式、PDF 哈希和页面引用，再以一个 IndexedDB 事务写入；恢复内容使用新文献 ID，不覆盖已有文献。普通导出 PDF 会合并批注，不能代替完整备份保留可编辑对象。

Safari 标签页、主屏幕版以及不同域名的存储可能独立。不要在确认恢复成功前删除旧入口或清理网站数据。备份不包含 API Key 或尚未发送的临时 AI 标记；后者请先发送或重新标记。

可申请持久保存，但浏览器不保证批准；主屏幕版本、定期完整备份和充足的设备空间可以减少数据丢失风险。更新下载完成后会显示“保存笔记并更新阅读器”，由你选择何时更新。

### 构建独立离线包

```bash
pnpm build:offline
pnpm preview:offline
```

构建输出在 `dist/offline/`，可复制到任意 HTTPS 静态网站。不要直接在“文件”中打开 `index.html`；离线缓存需要 HTTPS 网站环境。在电脑本机使用 `localhost` 也可测试，iPad 局域网访问则需要有效 HTTPS。

当前 GitHub Pages 使用 `codex/offline-pages` 分支发布生成的静态文件，源码在 `main`。部署时上传 `dist/offline/` 的全部文件，包括 `sw.js`、`pdfjs/`、图标和 `.nojekyll`。每次构建自动计算内容版本并生成完整资源清单，不缓存 AI 请求。

## 服务端版本部署

项目使用 React、TypeScript、Vinext / Vite 和 Cloudflare Workers。服务端模式中的 AI 代理需要后端运行；独立个人离线版直接连接 DeepSeek，可部署到 GitHub Pages 等静态托管。

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

原始 PDF 不上传到服务端。点击发送后，个人离线版由设备把定位原文、标记附近的截图、提示词和最近聊天上下文直接交给 DeepSeek；服务端版则由服务器转发。完整备份只通过设备的下载/分享操作保存。

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
