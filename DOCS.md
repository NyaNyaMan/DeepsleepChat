# DeepsleepChat 安卓版 · 使用与配置文档

> 版本 **1.4.1**（versionCode 10） · 包名 `com.deepseekchat.demo` · 更新于 2026-11-18
>
> 本文面向「拿到 APK 的人」和「要继续改这个项目的人」：前者看第一～九节，后者看第十～十三节。
> 改造与打包的技术细节另见 [ANDROID.md](./ANDROID.md)。

---

## 目录

1. [这是什么](#一这是什么)
2. [安装与首次启动](#二安装与首次启动)
3. [界面地图](#三界面地图)
4. [对话](#四对话)
5. [语音输入（按住说话）](#五语音输入按住说话)
6. [生图](#六生图)
7. [个性化：用户指令与长期记忆](#七个性化用户指令与长期记忆)
8. [接口与模型配置](#八接口与模型配置)
9. [数据、权限与隐私](#九数据权限与隐私)
10. [架构说明](#十架构说明)
11. [构建与发布](#十一构建与发布)
12. [故障排查](#十二故障排查)
13. [已知限制](#十三已知限制)
14. [版本历史](#十四版本历史)
15. [关键代码索引](#十五关键代码索引)

---

## 一、这是什么

把开源项目 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（纯前端静态聊天 SPA）改造成**装完即用的安卓应用**：

- 网页产物离线内置于 APK，**不需要装 Node、不需要起服务、不需要配环境**
- 首次打开只需填一个 API Key（也可以换成任何兼容接口的 Key）
- 在原项目基础上增加了：用户指令、长期记忆/用户画像、多套接口配置、生图（含参考图与完整参数）、产物库、语音「按住说话」、品牌图标与字标

与原项目的关系：**业务逻辑一行没改**，只在外面加了一层原生壳和一层能力适配，所以打开后的界面、Markdown 渲染、会话管理都是原版。

---

## 二、安装与首次启动

```bash
adb install -r build-output/app-release.apk
```

或把 APK 传到手机点击安装（需允许「安装未知来源应用」）。

- 桌面名称为 **DeepsleepChat**，安装标识 `com.deepseekchat.demo`，与官方 DeepSeek App（`com.deepseek.chat`）完全不同，**两者可共存**
- 最低系统 Android 8.0（API 26），目标 API 34，编译 API 35
- 升级覆盖安装即可，包名与签名不变，本地数据保留

**第一次打开**会自动弹出设置面板：

1. 选择「接口」里的服务商预设（默认 DeepSeek 官方）
2. 填入 API Key
3. 点「测试连接」确认可用（可选）
4. 关闭面板，直接开始对话

之后启动不再要求填写。Key 只存在本机。

---

## 三、界面地图

移动端布局（390dp 宽为基准）：

```
┌─────────────────────────────────────┐
│ ≡            会话标题       ▣   ✎   │  ← 侧边栏 / 产物库 / 新对话
├─────────────────────────────────────┤
│                                     │
│            对话区域                  │  ← 用户气泡靠右，助手回答靠左
│      （Markdown / 代码 / 表格 / 图）  │
│                                     │
├─────────────────────────────────────┤
│  [附件] [联网] [思考]   🖼  🎤  ↑     │  ← 输入工具行
│  ┌───────────────────────────────┐  │
│  │ 发消息或按住说话               │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

- **顶栏右侧**：九宫格图标 = 产物库；「+」= 新对话
- **输入行右侧**：图片图标 = 生图面板；麦克风/键盘图标 = 切换「打字 / 按住说话」；圆形按钮 = 发送或停止
- **侧边栏**：品牌字标、新对话、会话列表，底部是设置入口

---

## 四、对话

- 流式输出，可中途点停止；停止后可以继续生成
- 支持 Markdown、代码高亮、表格、LaTeX 公式、图表
- 「深度思考」开关会让支持思考的模型输出思考过程（DeepSeek / OpenAI 兼容的 `reasoning_content` 都会归到思考块）
- 「联网搜索」开关走原项目的服务端工具
- 回答下方可复制、朗读、重新生成；同一条消息的多次回答可左右切换分支
- 附件：支持拖拽/选择多个文件与图片（**仅 DeepSeek 官方接口**，见第八节）
- 导出/导入：设置 → 数据管理，导出为 ZIP（含会话与附件），可在另一台设备导入

---

## 五、语音输入（按住说话）

交互与微信一致：

| 操作 | 表现 |
| --- | --- |
| 点输入框右侧麦克风 | 输入区变成整条「按住 说话」按钮，发送键隐藏 |
| 按住 | 变浅蓝底，左侧「松开 结束」，中间实时声波，右侧读秒 |
| 松手 | 结束录音 → 转写 → 文字落到输入框，**自动切回键盘态** |
| 上滑 56px | 变红底「松开 取消」，松手丢弃这段录音 |
| 不足 0.5 秒 | 提示「说话时间太短」，不发请求 |
| 点键盘图标 | 回到打字态 |

**需要的权限**

| 权限 | 类型 | 说明 |
| --- | --- | --- |
| `RECORD_AUDIO` | 运行时 | 第一次按住时弹窗；拒绝后只影响语音 |
| `MODIFY_AUDIO_SETTINGS` | 普通（安装即授予） | WebView 录音时 Chromium 要切换 `AudioManager` 音频模式，缺这条会「系统显示已允许但采集仍失败」，且系统设置里看不到这项 |

**限制**：转写走 DeepSeek 的语音工具接口，切换成其他服务商后语音输入不可用，界面会提示。

---

## 六、生图

### 6.1 入口与流程

点输入行右侧图片图标 → **输入框上方就地展开面板**（不是弹窗）：

```
┌──────────────────────────────────┐
│ 生成图片        doubao-seedream-4-0 │ ← 面板头：标题 + 当前生图模型
│ [P1] [P2] [ + 添加 ]              │ ← 参考图，左上角编号，右上角删除
│ 参考图 2 张 · image                │ ← 当前实际发送方式（异常时变红）
│ ┌──────────────────────────────┐  │
│ │ 描述你想要的画面…              │  │ ← 提示词（自动带入输入框草稿）
│ └──────────────────────────────┘  │
│ 1:1  3:4  4:3  16:9  9:16  自定义  │ ← 比例
│ 高级参数                      ▾   │
│ [增强提示词]      1:1·1024×1024    │
│ [            生成            ]    │ ← 窄屏独占一行
└──────────────────────────────────┘
```

点「生成」后面板收起，**任务直接进入会话**：

1. **生成中**：会话里出现任务卡，转圈 + 提示词 + 「已用 Ns」实时计时
2. **成功**：原地变成图片消息，带提示词、尺寸、参考图编号、保存按钮
3. **失败**：变成红框错误卡，写明具体原因

同时图片自动进入产物库。

### 6.2 参考图与 P1/P2

- 一次最多 **6 张**，单张 ≤ 8 MB，支持一次多选
- 界面按顺序标 **P1、P2、P3…**，顺序即编号
- 发送前会把编号映射写进提示词，模型据此把「参考 P1」对到第 1 张图：

```
【参考图】共 2 张，按上传顺序编号：P1、P2（P1=第1张参考图，P2=第2张参考图）。
生成时必须参考这些图片的主体、构图与风格；文中出现某个编号时，指代该编号对应的参考图。
参考图权重：中（0.6），权重越高越贴近参考图。
参考 P1 的构图和风格，生成一张 3:4 的海报
```

- 参考图按会话保存，**只在内存里**，刷新页面会清空；要长期留用先存进产物库
- 结果卡上的「用作参考图」可把生成结果加回当前会话的参考图列表，做二次创作
- 产物库里的图片点一下也能「用作参考图」

### 6.3 参数

| 参数 | 取值 | 说明 |
| --- | --- | --- |
| 比例 | 1:1 / 3:4 / 4:3 / 16:9 / 9:16 / 自定义 | 自定义时直接填宽高，自动对齐到 8 的倍数 |
| 分辨率 | 1K / 2K / 4K | 决定长边像素（1024 / 1536 / 2048），短边按比例推算 |
| 数量 | 1–4 | 对应请求的 `n` |
| 种子 | 整数或留空 | 留空由服务端随机 |
| 反向提示词 | 文本 | 对应 `negative_prompt`，不希望出现的元素 |
| 参考图权重 | 0.2–1.0 | JSON 模式同时写进 `image_weight` 与提示词；multipart 模式只写提示词 |
| 额外参数 | JSON | 合并进请求体，用于服务商扩展字段，如 `{"guidance_scale": 3.5}` |

**增强提示词**：调用当前主模型（非流式），把一句话扩写成完整画面描述，回填到提示词框可继续编辑；失败会就地显示原因。

### 6.4 产物库

顶栏九宫格图标打开：

- 收集所有生成过的图片，按时间倒序，3 列缩略图
- 每张可删除，点击即「用作参考图」
- 存在 IndexedDB（`artifacts`），重启 App 仍在

---

## 七、个性化：用户指令与长期记忆

设置 → **个性化**

### 用户指令

自定义系统提示词，例如「我用中文提问就用中文回答；我是后端工程师，举例优先用 Go；回答尽量简短」。

每次请求都会拼成：

```
该助手为DeepSeek，由深度求索公司创造。

## 用户指令
以下是用户为自己设定的长期要求…：<你的内容>

## 关于用户的长期记忆
- 用户常住杭州，习惯用简体中文
- 用户是后端工程师，主要写 Go 和 Python
```

### 长期记忆 / 用户画像

- **自动学习**：每轮对话正常结束后，用一次轻量非流式请求抽取「关于用户的稳定信息」并写入记忆
- 规则：单条 ≤ 120 字、总量上限 60 条、归一化后去重、两次抽取至少间隔 20 秒、过短的一轮跳过
- **可手动增删**：列表逐条显示可删，底部可手动输入添加，右侧「清空全部」
- **可关闭**：关掉开关后既不学习也不注入
- 跨会话生效，存本机

界面只保留标题 + 开关 + 列表 + 一行说明小字，避免信息噪音。

---

## 八、接口与模型配置

设置 → **接口**

### 8.1 多套模型配置（档案）

顶部「模型配置」下拉 + 新建 / 重命名 / 删除。一套档案包含：

| 分类 | 字段 |
| --- | --- |
| 对话接口 | 服务商预设、接口地址、模型、协议、Key |
| 生图接口 | 接口地址、模型、Key、生图路径、额外参数、参考图发送方式 |
| 生成参数 | 温度、Top P、最大 tokens |

切换档案时整体生效并持久化，改任意一项也会自动写回当前档案。

### 8.2 对话接口

内置预设：

| 预设 | 接口前缀 | 协议 | 默认模型 |
| --- | --- | --- | --- |
| DeepSeek 官方 | `https://api.deepseek.com/anthropic/v1` | Anthropic 兼容 | `deepseek-flash` |
| OpenAI | `https://api.openai.com/v1` | OpenAI 兼容 | `gpt-4o-mini` |
| Moonshot / Kimi | `https://api.moonshot.cn/v1` | OpenAI 兼容 | `moonshot-v1-8k` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | OpenAI 兼容 | `glm-4-flash` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | OpenAI 兼容 | `deepseek-ai/DeepSeek-V3` |
| OpenRouter | `https://openrouter.ai/api/v1` | OpenAI 兼容 | `deepseek/deepseek-chat` |
| 自定义接口 | 自己填 | 可选 Anthropic / OpenAI | 自己填 |

两种协议的差异由代码内部双向翻译（请求体、流式事件），界面与渲染层不区分协议。

**只有 DeepSeek 官方预设支持**：附件上传、语音输入、朗读——它们依赖 DeepSeek 自己的 Files 与语音工具接口。切到其他服务商时这几处会提示不可用。

**模型行上的两个按钮**

| 按钮 | 行为 |
| --- | --- |
| 获取模型 | `GET {baseUrl}/models`，成功后出现下拉可直接点选（不会覆盖你已填的模型名） |
| 测试连接 | 先试 `/models`（同时验证地址与 Key）；遇到 404/405 这类不支持列表的服务，对话会退回发一条极短补全，用真实调用确认可用 |

结果以小字就地显示：`连接正常` / `已获取 N 个模型` / `连接失败：具体原因`。

**主模型参数**：温度、Top P、最大 tokens，留空用服务商默认值。按协议映射为 `temperature` / `top_p` / `max_tokens`。

### 8.3 生图接口

独立于对话接口：地址、Key（留空复用对话 Key）、模型、路径、额外参数、参考图发送方式。留空地址等于不启用生图（点生图按钮会引导到设置）。

必填格式：地址填到 `/v1` 为止，路径默认 `/images/generations`。

### 8.4 参考图发送方式（重点）

各家接口对参考图的字段要求不同，**字段不对时接口会静默忽略，结果只按提示词出图**——这是最容易踩的坑。

| 模式 | 实际请求 | 适用 |
| --- | --- | --- |
| `auto`（默认） | 按模型名推断，见下 | 大多数情况 |
| `image` | JSON，`"image": ["data:image/png;base64,…"]` | Seedream 4.0 / 4.5 / 5.0、多数 OpenAI 兼容网关 |
| `image` · 裸 Base64 | 同上，但去掉 `data:` 前缀 | 只收裸 base64 的网关 |
| `image_url` | JSON，`"image_url": [...]` | 要求该字段名的网关 |
| `images` | JSON，`"images": [...]` | 同上，另一种别名 |
| multipart | `POST {base}/images/edits`，`multipart/form-data`，参考图作为文件 | OpenAI `gpt-image-1` / `dall-e-2`（唯一支持参考图的官方方式） |
| 不发送 | 只发提示词 | 模型本身不支持图像输入 |

**auto 的推断规则**

- 模型名含 `gpt-image` 或 `dall-e-2` → multipart `/images/edits`
- 模型名含 `dall-e-3` → 不发送
- 其余 → `image` 字段

**明确不支持参考图的模型**（换字段无效，只能换模型）：

- `doubao-seedream-3.0-t2i`（纯文生图，需改用 SeedEdit 或 Seedream 4.0+）
- `dall-e-3`
- 名称里带 `t2i` / `text2image` 的文生图模型

设置页会显示「当前实际请求：`/images/generations`（image）」；模型名看起来只支持文生图时变红字警告。生图面板里加了参考图后也会显示当前发送方式，异常时直接标红。

**出错时的提示**：若接口返回的错误里含 `image` 且带 `not supported / invalid / unknown / 不支持` 等字样，界面不会甩原文，而是提示「接口不接受当前的参考图字段（…），可在设置 → 接口 → 参考图发送方式切换为 multipart 或 image_url」。

**生图路径**：默认 `/images/generations`，multipart 模式默认 `/images/edits`；网关路径不同时可以在「生图路径」里覆盖。

---

## 九、数据、权限与隐私

### 权限

| 权限 | 用途 |
| --- | --- |
| `INTERNET` | 调用接口 |
| `ACCESS_NETWORK_STATE` | 判断网络状态 |
| `RECORD_AUDIO` | 语音输入（运行时申请，仅点语音时弹） |
| `MODIFY_AUDIO_SETTINGS` | WebView 录音所需的音频模式切换（普通权限） |

没有存储权限：Android 10+ 写公共「下载」目录无需权限，8/9 写应用专属目录。

### 本机数据

**localStorage**（设置在 `appassets.local` 域下）

| 键 | 内容 |
| --- | --- |
| `chat-demo:api-key` | 对话接口 Key |
| `chat-demo:api-preset` / `api-base-url` / `api-model` / `api-protocol` | 当前对话接口 |
| `chat-demo:chat-params` | 温度 / Top P / 最大 tokens |
| `chat-demo:image-base-url` / `image-model` / `image-api-key` / `image-extra` | 生图接口 |
| `chat-demo:image-ref-mode` / `image-path` | 参考图发送方式与路径 |
| `chat-demo:profiles` / `active-profile` | 多套模型配置与当前选中项 |
| `chat-demo:custom-instructions` | 用户指令 |
| `chat-demo:memory-enabled` / `memories` | 记忆开关与条目 |
| `chat-demo:theme-preference` / `locale` / `tts-voice` / `thinking` / `search` / `sider-collapsed` | 外观与对话选项 |

**IndexedDB**（`chat-demo` 数据库，v12）：`sessions`（会话与消息）、`files`（附件）、`artifacts`（产物库）。

### 数据外发范围

- 对话内容只发往你配置的对话接口
- 生图提示词与参考图只发往你配置的生图接口
- 记忆抽取用你配置的对话接口（一次轻量请求）
- 没有统计、没有遥测、没有第三方 SDK；APK 内除网页产物外无其他依赖

---

## 十、架构说明

### 10.1 为什么是「原生壳 + 内置网页」

原项目是纯静态 SPA，业务逻辑全在浏览器里，只有 API 请求出网。直接把它装进 WebView 是最保真的改造方式：不用重写界面、不用重写协议，上游继续演进也能跟着走。

### 10.2 关键取舍：不用 `file://`

网页通过虚拟域名 `https://appassets.local` 访问，由 `WebViewClient.shouldInterceptRequest` 直接从 APK 的 `assets/www` 读文件返回（带正确 MIME 与缓存头）。

原因：`file://` 属于不透明来源，`localStorage` 和 `IndexedDB` 会被禁用——而 API Key 与聊天记录都存在那里，用 `file://` 打开会直接白屏。

### 10.3 原生补齐浏览器的缺失能力

`HostBridge`（`window.AndroidHost`）暴露的方法：

| 方法 | 作用 |
| --- | --- |
| `beginSave` / `appendSave` / `finishSave` / `cancelSave` | 分块接收 base64，写入系统「下载」目录（导出 ZIP、保存图片） |
| `openExternal` | 用系统浏览器/对应应用打开链接 |
| `ensureMicPermission` | 先拿系统麦克风权限，再让网页采集 |
| `setChromeColor` | 同步状态栏/导航栏颜色与图标明暗 |
| `toast` | 原生提示 |
| `platform` | 返回 `android`，网页据此启用适配层 |
| `httpRequestAsync` | 代网页发 HTTP 请求（JSON），结果异步回调到 `window.__hostHttpResult` |
| `httpMultipartAsync` | 代网页发 `multipart/form-data`（base64 → 原生还原字节后拼包） |

**为什么要代发请求**：第三方生图、模型列表接口通常不返回 CORS 头，WebView 里直接 `fetch` 会抛 `Failed to fetch`。原生请求不受同源策略限制。前端统一出口是 `src/services/nativeHttp.ts`：容器里走桥，浏览器里自动退回 `fetch`。

**为什么 multipart 必须由原生拼包**：JS 字符串经桥传到 Java 会按 UTF-8 编码，二进制图片数据会被破坏，所以 JS 只传 base64，由 Java 还原字节后组包。

### 10.4 网页侧改动边界

- `src/app/native-host.ts`：检测到 `window.AndroidHost` 才生效，在浏览器里是空操作
- `src/main.tsx`：挂载适配层

其余都是原项目代码，新增功能以独立模块加入（见第十五节）。

---

## 十一、构建与发布

```bash
npm install          # 首次
npm run build:apk    # 出正式包 → build-output/app-release.apk
npm run build:apk -- --debug   # 出调试包
```

`build:apk` 依次完成：构建网页（`dist/`）→ 复制到 `android/app/build/generated/webAssets/www` → Gradle 打包 → 汇总产物到 `build-output/`。`dist` 缺失会直接报错，不会产出空壳包。

| 依赖 | 要求 |
| --- | --- |
| Node.js | ≥ 18 |
| JDK | 17–21（AGP 8.7 不支持 25） |
| Android SDK | Platform 35 + Build-Tools 35 |
| Gradle | 8.11.1（仓库自带 wrapper） |

常用改动位置见 [ANDROID.md](./ANDROID.md) 第七节。仓库里不含任何证书：首次出正式包会在本地生成演示证书与随机口令，均写入被 git 忽略的文件。正式分发务必换成自己的证书。

---

## 十二、故障排查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 安装报「应用未安装」 | 手机上有同包名不同签名的旧版（早期版本曾用 `com.deepseek.chat`，与官方 App 相同） | `adb uninstall com.deepseek.chat` 后重装 |
| 点语音立刻提示失败 | 缺 `MODIFY_AUDIO_SETTINGS`，或权限被拒 | 1.4.0 已修；仍失败时去系统设置检查麦克风权限 |
| 生图报 `Failed to fetch` | 网页直连第三方接口被 CORS 拦 | 1.2.0 起容器内改走原生代发，已修；浏览器里调试仍会受限 |
| **参考图完全不生效** | 接口字段不对，或模型不支持图像输入 | 看设置里「当前实际请求」；换模型（Seedream 4.0+ / gpt-image-1）或切换发送方式 |
| 生图提示接口拒绝 image 字段 | 字段名或模式不匹配 | 按提示切 multipart / image_url |
| 切换服务商后附件、语音、朗读不可用 | 这些能力只由 DeepSeek 官方接口提供 | 换回 DeepSeek 官方预设，或接受缺失 |
| 自定义对话接口报跨域 | 聊天流式请求仍走 `fetch`，需要接口允许 CORS | 给网关加 CORS 头，或改用 DeepSeek 官方 |
| 导出历史后再导入，生图消息为空 | 导出格式只认文本/思考类块 | 已知限制，见第十三节 |
| 参考图刷新后消失 | 参考图只存在内存 | 存进产物库再取回 |
| 构建卡在下载 Gradle/依赖 | `services.gradle.org`、`dl.google.com` 网络慢 | 用镜像：wrapper 指向腾讯镜像，`~/.gradle/init.gradle` 加阿里云仓库 |

---

## 十三、已知限制

1. **参考图不持久化**：按会话存在内存，刷新清空（产物库持久）。
2. **生图消息不参与导出**：历史导出的片段格式只认文本/思考块，导入后该条为空消息。
3. **对话流式请求不走原生**：自定义对话接口若完全不支持 CORS，聊天仍会失败（生图、模型列表已不受影响）。
4. **附件/语音/朗读绑定 DeepSeek 官方接口**：其 Files 与语音工具接口没有 OpenAI 兼容替代。
5. **参考图字段是通用约定**：`image` / `image_url` / `images` / multipart 四种已覆盖主流，仍有个别网关自定义字段名，可用「生图额外参数」自行补。
6. **演示签名**：发布前需换证书。

---

## 十四、版本历史

| 版本 | versionCode | 主要变化 |
| --- | --- | --- |
| 1.0.0 | 1 | 首个可安装版本：原生壳 + 内置网页，离线加载，附件、语音、导出、返回键、状态栏适配 |
| 1.0.1 | 2 | 包名改为 `com.deepseekchat.demo`，修复与官方 App 冲突导致无法安装 |
| 1.0.2 | 3 | 语音失败修复（先由原生拿权限再采集，等待期间不暂停 WebView，Abort 自动重试） |
| 1.0.3 | 4 | 补 `MODIFY_AUDIO_SETTINGS`，修复「权限已允许但录音仍失败」 |
| 1.0.4 | 5 | 输入区改为「键盘 / 按住说话」双模，支持上滑取消、过短提示 |
| 1.1.0 | 6 | 用户指令、长期记忆、可切换 API（含 OpenAI 协议适配）、生图接口、鲸鱼图标与 deepsleep 字标 |
| 1.2.0 | 7 | 记忆区精简；对话与生图模型支持「获取模型 / 测试连接」；生图改为会话内面板；原生代发请求修复 `Failed to fetch` |
| 1.3.0 | 8 | 参考图 P1/P2 编号、会话内生图任务态、完整生图参数、产物库、多套模型配置、主模型参数、图标 logo 缩至 3/4 |
| 1.4.0 | 9 | 参考图发送方式（auto / image / 裸 Base64 / image_url / images / multipart）、原生 multipart、字段被拒与纯文生图模型的明确提示 |
| 1.4.1 | 10 | 应用名称改为 DeepsleepChat，同步桌面名称、页面标题、字标替代文本、构建脚本与文档 |

---

## 十五、关键代码索引

| 能力 | 位置 |
| --- | --- |
| 原生容器、assets 服务、文件选择、权限、返回键 | `android/app/src/main/java/com/deepseek/chat/MainActivity.java` |
| JS 桥（保存、外链、麦克风、状态栏、HTTP、multipart） | `android/app/src/main/java/com/deepseek/chat/HostBridge.java` |
| 网页侧原生适配层 | `src/app/native-host.ts` |
| 统一 HTTP 出口（桥 / fetch 自动切换） | `src/services/nativeHttp.ts` |
| 设置存储、档案、参数 | `src/services/settings.ts` |
| 服务商预设 | `src/services/api/providers.ts` |
| 协议适配与流式请求 | `src/services/api/client.ts` |
| 生图请求、参数、参考图模式 | `src/services/image.ts` |
| 参考图状态（P1/P2） | `src/services/imageRefs.ts` |
| 生图任务编排（写入会话、更新状态） | `src/services/imageTask.ts` |
| 产物库 | `src/services/artifacts.ts` + `src/components/artifacts/` |
| 生图面板 | `src/components/image/ImagePanel.tsx` |
| 会话内图片 / 任务卡 | `src/components/messages/GeneratedImage.tsx` |
| 用户指令与系统提示词组装 | `src/services/personalization.ts` |
| 长期记忆抽取 | `src/services/memory.ts` |
| 语音输入 | `src/components/chatInput/useVoiceInput.ts` |
| 接口自检（获取模型 / 测试连接） | `src/services/models.ts` |
| 一键打包 | `scripts/build-apk.mjs` |
| 网页构建 | `scripts/build-web.mjs` |
