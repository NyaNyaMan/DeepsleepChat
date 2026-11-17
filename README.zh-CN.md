# DeepsleepChat

[English](README.md) | 简体中文

DeepsleepChat 是 DeepSeek API 的安卓客户端。界面取自 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 的静态聊天页面，外面套了一层原生容器，整个界面随 APK 一起安装，启动不依赖服务器，也不用配环境。首次打开填一次 API Key 就能用。

在原版基础上加了用户指令、长期记忆、多套接口配置、带参考图的生图与产物库。界面按手机竖屏设计，除你配置的接口请求外完全离线运行。

APK 从 [Releases](https://github.com/NyaNyaMan/DeepsleepChat/releases/latest) 下载。使用说明见 [DOCS.md](DOCS.md)，原生容器与打包细节见 [ANDROID.md](ANDROID.md)，执行 `npm run build:apk` 可从源码重新出包。

## 安装

把 APK 传到手机打开，按提示允许「安装未知来源应用」。安装标识是 `com.deepseekchat.demo`，可与官方 DeepSeek App 共存。首次启动会弹出设置：选服务商、粘贴 API Key、关闭面板即可开始对话。

## 从源码构建

需要 Node.js 22.12+、pnpm、JDK 17–21 和 Android SDK Platform 35。

```sh
git clone https://github.com/NyaNyaMan/DeepsleepChat.git
cd DeepsleepChat
pnpm install
pnpm build:apk
```

签名包输出到 `build-output/app-release.apk`。本地没有证书时脚本会临时生成一份并排除在 git 之外，正式分发前请替换成自己的证书。

## 网页版

同一套界面也能打成纯静态站点：`pnpm build` 输出 `dist/`，APK 内置的正是这份产物。可以部署到任意静态服务器，或在浏览器允许 `file://` 存储时直接打开 `dist/index.html`。手机上选附件走系统文件选择器，拖拽只在桌面浏览器里才有。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件从系统文件选择器选取，按住说话输入，回复可朗读；录音时输入框显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 生图支持最多 6 张编号参考图，可调比例、分辨率、种子与反向提示词，结果自动进产物库。
- 用户指令与长期记忆、多套接口配置、中英文界面、深浅主题、历史导入导出。

## 数据

API Key 和设置保存在应用内 WebView 的 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                |
| ------------- | ------------------- |
| `pnpm dev`    | 启动开发服务器      |
| `pnpm build`  | 构建到 `dist/`      |
| `pnpm type`   | TypeScript 类型检查 |
| `pnpm lint`   | oxlint 检查         |
| `pnpm format` | oxfmt 格式化        |

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求使用搜索、链接阅读、标题和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留。本项目基于 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 改造，原始版权声明保留在 [LICENSE](LICENSE) 中；第三方依赖遵循各自的许可证。
