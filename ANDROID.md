# 安卓 App 打包说明

> 面向使用者的功能、配置、排障与版本历史见 [DOCS.md](./DOCS.md)；本文只讲改造思路与打包。

把 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 这个纯前端静态聊天项目，改造成**装完即用的安卓应用**：安装后打开就能聊天，除了一次性填写 API Key，不需要装 Node、不需要起服务、不需要配环境变量。

---

## 一、改造思路

原项目是 rspack 打包出来的纯静态 SPA，所有业务逻辑（会话管理、流式回复、Markdown/公式/图表渲染、附件、语音、朗读、主题）都在浏览器里跑，只有 API 请求发往 `https://api.deepseek.com`。

因此**不重写界面、不重写协议**，而是做一个"原生外壳 + 内置网页资源"的容器：

| 原项目里的能力 | 浏览器里由谁提供 | 打包进 App 后 |
| --- | --- | --- |
| 页面本身 | 静态服务器 / GitHub Pages | 网页产物打进 APK `assets/www`，由原生 `shouldInterceptRequest` 直接读 assets，**本地零依赖、不需要起服务** |
| API Key、主题等设置 | `localStorage` | 同上（虚拟域名 `https://appassets.local` 是安全上下文，storage 正常持久化） |
| 聊天记录 | `IndexedDB` | 同上（**这是不用 `file://` 加载的关键原因**：`file://` 属不透明来源，IndexedDB 会被禁用） |
| 流式回复 | `fetch` + `ReadableStream` | WebView 内一致，直接走 HTTPS 调 API |
| 选择附件 | `<input type="file">` | `WebChromeClient.onShowFileChooser` → 系统文件选择器（保留多选、按扩展名过滤） |
| 语音输入 | `getUserMedia` + `AudioContext` | `onPermissionRequest` → 动态申请 `RECORD_AUDIO` |
| 朗读回复 | `AudioContext` 播放 PCM | 同上，另外关闭了"必须用户手势才能播放"的限制 |
| 导出聊天记录 | `<a download>` 下载 ZIP | 浏览器专属行为，WebView 无下载回调 → 通过 JS 桥分块交给原生写入系统「下载」目录 |
| 引用链接、附件预览 | `window.open` | 走系统浏览器 / 对应应用打开 |
| 返回键 | 浏览器后退 | 先关闭抽屉、设置弹层、搜索面板，再退出应用 |
| 状态栏配色 | `<meta name="theme-color">` | 网页把实际背景色通过桥接同步给原生，状态栏/导航栏与页面同色、图标明暗跟随 |

网页侧改动只有两处新增文件，不侵入原有逻辑：

- `src/app/native-host.ts` — 检测到 `window.AndroidHost` 才生效，在浏览器里是空操作，原网页行为完全不变
- `src/main.tsx` — 挂载上面这个适配层

### 相对上游新增的能力

| 功能 | 说明 | 代码位置 |
| --- | --- | --- |
| 用户指令 | 自定义系统提示词，每次请求都拼进 `system` | `services/personalization.ts` + 设置 → 个性化 |
| 长期记忆 / 用户画像 | 对话结束后用一次轻量请求抽取用户事实，跨会话注入；可开关、可手动增删、去重上限 60 条 | `services/memory.ts` |
| 可切换 API 接口 | 内置 DeepSeek 官方（anthropic 兼容）、OpenAI、Moonshot、智谱、硅基流动、OpenRouter，外加自定义（地址/模型/协议可选） | `services/api/providers.ts` |
| OpenAI 协议适配 | 把 Anthropic 风格的消息体与流式事件双向翻译，上层渲染逻辑不用区分协议 | `services/api/client.ts` |
| 生图接口 | 独立配置 `images/generations`；会话内面板（参考图 / 比例 / 高级参数 / 增强提示词），任务状态与结果都落在会话里 | `services/image.ts` + `components/image/ImagePanel.tsx` |
| 参考图与编号 | 一次可选多张参考图，界面标注 P1、P2…；请求时把编号与顺序写进提示词，模型据此对应「参考 P1」 | `services/imageRefs.ts` |
| 参考图发送方式 | auto / image / 裸 Base64 / image_url / images / multipart `/images/edits` / 不发送，可按模型名自动识别；JSON 字段被拒或模型只支持文生图时给出明确提示 | `services/image.ts` |
| 生图参数 | 比例 1:1 / 3:4 / 4:3 / 16:9 / 9:16 / 自定义宽高、1K/2K/4K、反向提示词、数量、种子、参考图权重、额外 JSON | `services/image.ts` |
| 产物库 | 右上角入口，收集所有生成图，可删除或再次用作参考图 | `components/artifacts/` + `services/artifacts.ts` |
| 多套模型配置 | 对话 + 生图 + 参数整套保存，可新建 / 重命名 / 删除 / 随时切换 | `services/settings.ts`（profiles） |
| 主模型参数 | 温度 / Top P / 最大 tokens，按协议映射到请求体 | `services/api/client.ts` |
| 接口自检 | 对话与生图模型都支持「获取模型」（GET /models）与「测试连接」（先 /models，不支持时退回一次真实调用） | `services/models.ts` + `components/settings/ApiSettings.tsx` |
| 品牌替换 | 应用图标、启动页、欢迎页、侧边栏字标换成自定义素材（从原图抠出的透明 PNG） | `src/assets/`、`res/drawable-nodpi/` |

切换非 DeepSeek 接口后，附件上传、语音输入、朗读会失效（它们走 DeepSeek 自己的 Files 与语音工具接口），界面上会有提示。

## 二、目录结构

```
DeepsleepChat/
├── DOCS.md                    # 功能、配置、排障、版本历史（面向使用者）
├── src/                       # 原项目源码（新增 src/app/native-host.ts 与各功能模块）
├── scripts/
│   ├── build-web.mjs          # 跨平台生产构建（npm run build）
│   └── build-apk.mjs          # 一键出包（npm run build:apk）
├── tools/cdp.mjs              # 本地移动端布局验收脚本（开发自用，不参与打包）
└── android/                   # 安卓工程（Gradle 8.11.1 + AGP 8.7.3，纯 Java，无第三方依赖）
    ├── settings.gradle
    ├── build.gradle
    ├── gradle.properties
    ├── keystore.properties    # 本地签名配置（首次出正式包时自动生成，不入库）
    ├── keystore/demo-release.jks  # 演示证书（同上，不入库）
    └── app/
        ├── build.gradle       # 打包配置；syncWebAssets 把 ../dist 复制到 build/generated/webAssets/www
        └── src/main/
            ├── AndroidManifest.xml
            ├── java/com/deepseek/chat/MainActivity.java   # WebView 容器、assets 服务、文件选择、权限、返回键
            ├── java/com/deepseek/chat/HostBridge.java     # JS 桥：保存文件、开外链、麦克风、状态栏、HTTP / multipart
            └── res/                                       # 图标、启动图配色、主题
                ├── drawable-nodpi/ic_launcher_foreground.png   # 自适应图标前景（抠好的鲸鱼 PNG）
                └── values/colors.xml                           # 图标底色与窗口背景
```

网页产物不落在源码目录里，构建时由 Gradle 复制到 `app/build/generated/webAssets/www` 后再打包，源码树保持干净。

## 三、环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 18（实测 22） | 构建网页 |
| JDK | **17～21** | AGP 8.7 的要求；用 JDK 25 等过新版本会报错 |
| Android SDK | Platform 35 + Build-Tools 35 | `compileSdk 35`，`minSdk 26`（Android 8.0+） |
| Gradle | 8.11.1 | 仓库内自带 wrapper，首次构建自动下载 |

设置好 `ANDROID_HOME`（或 `android/local.properties` 里的 `sdk.dir`）和 `JAVA_HOME` 即可。

## 四、构建

```bash
pnpm install                # 或 npm install
pnpm build:apk              # 或 npm run build:apk，出正式包
pnpm build:apk -- --debug   # 出调试包
```

产物会汇总到 `build-output/`：

- `app-release.apk` — 已签名，可直接安装；本地没有证书时会先用 keytool 生成一份演示证书，口令随机生成并写入本地的 `keystore.properties`（两者都不入库），仅供自用
- `app-debug.apk` — 调试包（`--debug` 时），用 Gradle 自带的 debug 签名，不涉及上面的证书

也可以分步执行（等价）：

```bash
npm run build                        # 生成 dist/
cd android && ./gradlew assembleRelease
```

Gradle 任务会自动把 `dist/` 同步进 `assets/www`；如果 `dist/index.html` 不存在会直接报错并提示先构建网页，不会产出空壳包。

## 五、安装与首次使用

```bash
adb install -r build-output/app-release.apk
```

或者把 APK 传到手机点击安装（需允许"安装未知来源应用"）。

App 的桌面名称是 **DeepsleepChat**，安装标识是 `com.deepseekchat.demo`，与官方 DeepSeek App（`com.deepseek.chat`）完全独立，两者可以同时装在一台手机上。

1. 打开 App，自动弹出设置面板
2. 填入 DeepSeek API Key（[platform.deepseek.com](https://platform.deepseek.com/api_keys) 获取），保存
3. 直接开始对话 — 之后启动不再要求填写

API Key 只存在本机 `localStorage`，除调用 DeepSeek 接口外不会被发往任何地方。

## 六、已处理的安卓侧细节

- **启动体验**：与应用同色的启动页 + 品牌图标，网页首帧可见后淡出，无白屏闪烁；8 秒兜底
- **主题**：跟随系统深浅色；应用内切换主题时状态栏、导航栏实时跟着变（导航栏图标明暗一起切换）
- **键盘**：`adjustResize` + 页面自身的 `visualViewport` 逻辑，输入框与顶栏不会被键盘顶出屏幕
- **旋转 / 分屏**：`configChanges` 接管，不重建 Activity，进行中的流式回复不会中断
- **进程回收**：`saveState`/`restoreState` 保留页面状态与滚动位置
- **权限**：只有麦克风是运行时权限，且仅在点语音按钮时才申请；无麦克风设备也能安装。另外声明了 `MODIFY_AUDIO_SETTINGS`（普通权限，安装即授予）——WebView 录音时 Chromium 要切 `AudioManager` 的音频模式，缺这条会"系统显示麦克风已允许但采集仍然失败"
- **语音输入顺序**：点按钮后先由原生申请系统权限，拿到后再让网页 `getUserMedia`。反过来做的话，系统权限弹窗会让 Activity 进入 paused，把 WebView 里挂起的采集请求打断，表现就是"点了立刻提示语音识别失败"。等待权限期间也刻意不暂停 WebView，并对 AbortError/NotReadableError 自动重试一次。
- **输入方式**：右下角按钮在「键盘打字 / 按住说话」之间切换；语音态是微信式的按住说话（松手转写并回到键盘态、上滑取消、不足 0.5 秒按误触处理）。按钮上关掉了 `touch-action` 与文本选择，长按不会触发系统菜单或页面滚动。
- **文件保存**：Android 10+ 写入公共「下载」目录（无需存储权限）；8/9 写入应用专属下载目录
- **第三方接口跨域**：生图、模型列表这类请求在网页里直接 `fetch` 会被 CORS 拦成 `Failed to fetch`。容器里统一走 `HostBridge.httpRequestAsync`（原生 `HttpURLConnection`）代发，结果异步回到 `window.__hostHttpResult`，不受同源策略限制；浏览器里自动退回普通 fetch。
- **安全**：禁止明文 HTTP、禁止页面直接读本地文件、外链只允许 http/https/mailto/tel 交给系统处理
- **体积**：网页产物约 4.8 MB，Release APK 约 2.0 MB（zip 压缩后），无任何第三方 SDK

## 七、常见改动

| 想改什么 | 改哪里 |
| --- | --- |
| 应用名 | `android/app/src/main/res/values/strings.xml` 的 `app_name` |
| 包名 | `android/app/build.gradle` 的 `applicationId`（安装标识，别用 `com.deepseek.chat`，那是官方 App）；`namespace` 只影响 Java 包名 |
| 图标 | 前景 `android/app/src/main/res/drawable-nodpi/ic_launcher_foreground.png`（建议 432×432、logo 占约 46%）+ `values/colors.xml` 的 `ic_launcher_background`；网页里的欢迎页图标与侧边栏字标在 `src/assets/` |
| API 地址 | `rspack.config.ts` 中 `createConfig({ apiOrigin: 'https://...' })`，或在 `scripts/build-web.mjs` 传参 |
| 签名 | 替换 `android/keystore/demo-release.jks`，并同步 `android/keystore.properties` |
| 最低系统版本 | `android/app/build.gradle` 的 `minSdk` |

签名文件与口令不进 git（`.gitignore` 已排除 `android/keystore.properties` 和 `android/keystore/`）。`build:apk` 出正式包时若发现缺失会自动生成一份演示证书；正式发布请换成自己的证书，更新 `keystore.properties` 中的路径与口令即可。换证书后老用户需卸载重装（签名不一致无法覆盖安装）。

## 八、常见问题

**构建卡在下载 Gradle / 依赖**
`services.gradle.org` 与 `dl.google.com` 在部分网络下很慢。可以让 Gradle 走国内镜像：

```bash
# 1) Gradle 发行版：把 android/gradle/wrapper/gradle-wrapper.properties 的 distributionUrl 换成
#    https://mirrors.cloud.tencent.com/gradle/gradle-8.11.1-bin.zip
# 2) 依赖仓库：在 ~/.gradle/init.gradle 里追加 aliyun 的 google/public/gradle-plugin 仓库
```

**报 `Unsupported class file major version` / JDK 相关错误**
换 JDK 17 或 21（`JAVA_HOME` 指向它）。JDK 25 目前不被 AGP 8.7 支持。

**安装时报"应用未安装" / 提示与已安装的 DeepSeek 签名不一致**
说明包名和手机上已有应用撞了。本项目用的是 `com.deepseekchat.demo`，不会和官方 App 冲突；但如果装过早期版本（包名曾是 `com.deepseek.chat`，正好与官方 App 相同），先卸载旧版再装：

```bash
adb uninstall com.deepseek.chat      # 早期版本
adb uninstall com.deepseekchat.demo  # 本项目当前版本
```

注意第二条只会卸载本 App，不会影响官方 DeepSeek。

**语音按钮点了没反应**
第一次会弹麦克风授权；如果之前拒绝过，去「系统设置 → 应用 → DeepsleepChat → 权限」重新打开。

**想彻底清空数据**
系统设置里清除应用数据，或在 App 内「设置 → 数据管理 → 删除所有对话」。
