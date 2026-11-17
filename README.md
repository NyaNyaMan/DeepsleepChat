# DeepsleepChat

English | [简体中文](README.zh-CN.md)

DeepsleepChat is an Android client for the DeepSeek API. It takes the static chat UI from [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) and wraps it in a native container, so the whole interface ships inside the APK and starts without a server or any additional setup. You enter an API key once on first launch.

On top of the upstream client it adds custom instructions, long-term memory, multiple API profiles, image generation with reference images, and an artifact library. The interface is laid out for phones and works entirely offline apart from the API calls you configure.

Download the APK from [Releases](https://github.com/NyaNyaMan/DeepsleepChat/releases/latest). [DOCS.md](DOCS.md) is the user manual, [ANDROID.md](ANDROID.md) explains the native wrapper, and `npm run build:apk` rebuilds the package from source.

## Install

Open the APK on the phone and allow installation from unknown sources when prompted. The package id is `com.deepseekchat.demo`, so it can sit next to the official DeepSeek app. The first launch opens Settings: pick a provider, paste an API key, and close the panel.

## Build from source

You need Node.js 22.12+, pnpm, JDK 17–21, and Android SDK Platform 35.

```sh
git clone https://github.com/NyaNyaMan/DeepsleepChat.git
cd DeepsleepChat
pnpm install
pnpm build:apk
```

The signed package lands in `build-output/app-release.apk`. Without a local keystore the script generates a throwaway one and keeps it out of git; replace it before distributing widely.

## Web build

The same UI still builds as a plain static site: `pnpm build` writes `dist/`, which is also what gets bundled into the APK. Serve it from any static host, or open `dist/index.html` directly if the browser allows storage on `file://` pages. Attachments are picked from the system file dialog on phones; drag and drop only exists in the desktop browser.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Attachments picked from the system file dialog, hold-to-talk voice input, and read-aloud replies; a live spectrum runs while you record.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Image generation with up to six numbered reference images, aspect ratio, resolution, seed, negative prompt, and an artifact library that keeps every result.
- Custom instructions and long-term memory, multiple API profiles, Chinese and English UI, light and dark themes, and chat history import and export.
- Built-in update check: reads the latest GitHub release, verifies package name, version, and signing certificate, then hands the APK to the system installer.

## Data and storage

Your API key and settings are stored in localStorage inside the app's WebView. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command       | Description                  |
| ------------- | ---------------------------- |
| `pnpm dev`    | Start the development server |
| `pnpm build`  | Build into `dist/`           |
| `pnpm type`   | Run TypeScript type checks   |
| `pnpm lint`   | Lint with oxlint             |
| `pnpm format` | Format with oxfmt            |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy.

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. This project is derived from [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo), and the original copyright notice is kept in [LICENSE](LICENSE). Third-party dependencies are subject to their own licenses.
