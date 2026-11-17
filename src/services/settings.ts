import { create } from 'zustand'
import { createId } from '../utils/id.js'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 对话接口的协议：DeepSeek 的 anthropic 兼容接口，或 OpenAI 兼容的 chat/completions */
export type ApiProtocol = 'anthropic' | 'openai'

/**
 * 参考图怎么发给生图接口。各家差异很大，字段名不对时接口会静默忽略，结果只按提示词出图：
 * - auto：按模型名与地址推断（默认）
 * - image：image: [dataURL...]（Seedream 4.0+、多数 OpenAI 兼容网关）
 * - image-raw：image: [裸 base64]（只收裸 base64 的网关）
 * - image-url：image_url: [...]
 * - images：images: [...]
 * - edits：POST /images/edits，multipart 上传（OpenAI gpt-image-1 / dall-e-2 唯一支持参考图的方式）
 * - off：不发送参考图，只发提示词
 */
export type ImageRefMode = 'auto' | 'image' | 'image-raw' | 'image-url' | 'images' | 'edits' | 'off'

/** 主模型的自定义参数，留空表示用服务商默认值 */
export type ChatParams = {
  temperature?: number
  topP?: number
  maxTokens?: number
}

/** 一套完整的模型配置：对话 + 生图 + 参数，可保存多套随时切换 */
export type EndpointProfile = {
  id: string
  name: string
  apiPreset: string
  apiBaseUrl: string
  apiModel: string
  apiProtocol: ApiProtocol | ''
  apiKey: string | null
  imageBaseUrl: string
  imageModel: string
  imageApiKey: string
  imageExtra: string
  imageRefMode: ImageRefMode
  imagePath: string
  chatParams: ChatParams
}

/** 一条关于用户的长期记忆，会随每次请求注入系统提示词 */
export type MemoryItem = {
  id: string
  text: string
  createdAt: number
}

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态、
 * 用户指令与长期记忆、对话接口与生图接口配置 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /** 用户指令（自定义系统提示词），始终拼在系统提示词里 */
  customInstructions: string
  /** 是否在对话结束后自动更新用户画像 */
  memoryEnabled: boolean
  /** 长期记忆 / 用户画像条目 */
  memories: MemoryItem[]
  /** 接口预设 id，见 api/providers.ts */
  apiPreset: string
  /** 覆盖预设的接口前缀，空表示用预设默认值 */
  apiBaseUrl: string
  /** 覆盖预设的模型名 */
  apiModel: string
  /** 覆盖预设的协议，空表示跟随预设 */
  apiProtocol: ApiProtocol | ''
  /** 生图接口前缀（OpenAI 兼容的 images/generations） */
  imageBaseUrl: string
  imageModel: string
  /** 生图接口的 Key，空表示复用对话接口的 Key */
  imageApiKey: string
  /** 生图额外参数（JSON 字符串），合并进请求体 */
  imageExtra: string
  /** 参考图发送方式 */
  imageRefMode: ImageRefMode
  /** 生图接口路径，默认 /images/generations */
  imagePath: string
  /** 主模型自定义参数 */
  chatParams: ChatParams
  /** 保存的模型配置列表 */
  profiles: EndpointProfile[]
  activeProfileId: string
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  customInstructions: 'chat-demo:custom-instructions',
  memoryEnabled: 'chat-demo:memory-enabled',
  memories: 'chat-demo:memories',
  apiPreset: 'chat-demo:api-preset',
  apiBaseUrl: 'chat-demo:api-base-url',
  apiModel: 'chat-demo:api-model',
  apiProtocol: 'chat-demo:api-protocol',
  imageBaseUrl: 'chat-demo:image-base-url',
  imageModel: 'chat-demo:image-model',
  imageApiKey: 'chat-demo:image-api-key',
  imageExtra: 'chat-demo:image-extra',
  imageRefMode: 'chat-demo:image-ref-mode',
  imagePath: 'chat-demo:image-path',
  chatParams: 'chat-demo:chat-params',
  profiles: 'chat-demo:profiles',
  activeProfileId: 'chat-demo:active-profile',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 读取 JSON 形式的设置项，结构不合法时回退到默认值 */
const readJson = <T>(key: string, fallback: T, normalize: (value: unknown) => T | null): T => {
  try {
    const raw = read(key)
    if (!raw) {
      return fallback
    }
    return normalize(JSON.parse(raw)) ?? fallback
  } catch {
    return fallback
  }
}

/** 记忆条目只接受结构完整的项，避免旧数据或手改的数据弄坏界面 */
const normalizeMemories = (value: unknown): MemoryItem[] | null => {
  if (!Array.isArray(value)) {
    return null
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return []
    }
    const { id, text, createdAt } = item as Partial<MemoryItem>
    if (typeof id !== 'string' || typeof text !== 'string' || !text.trim()) {
      return []
    }
    return [
      {
        id,
        text: text.trim(),
        createdAt: typeof createdAt === 'number' ? createdAt : Date.now(),
      },
    ]
  })
}

const normalizeChatParams = (value: unknown): ChatParams | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const source = value as Record<string, unknown>
  const pick = (key: string) =>
    typeof source[key] === 'number' && Number.isFinite(source[key] as number)
      ? (source[key] as number)
      : undefined
  const params: ChatParams = {
    temperature: pick('temperature'),
    topP: pick('topP'),
    maxTokens: pick('maxTokens'),
  }
  return params
}

const REF_MODES: ImageRefMode[] = [
  'auto',
  'image',
  'image-raw',
  'image-url',
  'images',
  'edits',
  'off',
]

const normalizeRefMode = (value: unknown): ImageRefMode =>
  REF_MODES.includes(value as ImageRefMode) ? (value as ImageRefMode) : 'auto'

const normalizeProfiles = (value: unknown): EndpointProfile[] | null => {
  if (!Array.isArray(value)) {
    return null
  }
  const items = value.flatMap((item): EndpointProfile[] => {
    if (!item || typeof item !== 'object') {
      return []
    }
    const source = item as Partial<EndpointProfile>
    if (typeof source.id !== 'string' || typeof source.name !== 'string') {
      return []
    }
    return [
      {
        id: source.id,
        name: source.name,
        apiPreset: typeof source.apiPreset === 'string' ? source.apiPreset : 'deepseek',
        apiBaseUrl: typeof source.apiBaseUrl === 'string' ? source.apiBaseUrl : '',
        apiModel: typeof source.apiModel === 'string' ? source.apiModel : '',
        apiProtocol:
          source.apiProtocol === 'anthropic' || source.apiProtocol === 'openai'
            ? source.apiProtocol
            : '',
        apiKey: typeof source.apiKey === 'string' ? source.apiKey : null,
        imageBaseUrl: typeof source.imageBaseUrl === 'string' ? source.imageBaseUrl : '',
        imageModel: typeof source.imageModel === 'string' ? source.imageModel : '',
        imageApiKey: typeof source.imageApiKey === 'string' ? source.imageApiKey : '',
        imageExtra: typeof source.imageExtra === 'string' ? source.imageExtra : '',
        imageRefMode: normalizeRefMode(source.imageRefMode),
        imagePath: typeof source.imagePath === 'string' ? source.imagePath : '',
        chatParams: normalizeChatParams(source.chatParams) ?? {},
      },
    ]
  })
  return items.length > 0 ? items : null
}

const initialApiProtocol = (): ApiProtocol | '' => {
  const saved = read(KEYS.apiProtocol)
  return saved === 'anthropic' || saved === 'openai' ? saved : ''
}

/** 当前生效的接口与参数：既写进扁平设置，也回写到对应的配置档案 */
const readFlat = () => ({
  apiKey: read(KEYS.apiKey),
  apiPreset: read(KEYS.apiPreset) ?? 'deepseek',
  apiBaseUrl: read(KEYS.apiBaseUrl) ?? '',
  apiModel: read(KEYS.apiModel) ?? '',
  apiProtocol: initialApiProtocol(),
  imageBaseUrl: read(KEYS.imageBaseUrl) ?? '',
  imageModel: read(KEYS.imageModel) ?? '',
  imageApiKey: read(KEYS.imageApiKey) ?? '',
  imageExtra: read(KEYS.imageExtra) ?? '',
  imageRefMode: normalizeRefMode(read(KEYS.imageRefMode)),
  imagePath: read(KEYS.imagePath) ?? '',
  chatParams: readJson(KEYS.chatParams, {}, normalizeChatParams),
})

const initialProfiles = (flat: ReturnType<typeof readFlat>): EndpointProfile[] => {
  const saved = readJson(KEYS.profiles, [], normalizeProfiles)
  if (saved.length > 0) {
    return saved
  }
  // 首次升级：用现有扁平配置生成默认档案
  return [{ id: 'default', name: '默认配置', ...flat }]
}

/** 修改接口相关设置时同步写回当前档案，切换回来仍是这套配置 */
const syncActiveProfile = (patch: Partial<EndpointProfile>) => {
  const { profiles, activeProfileId } = useSettings.getState()
  const next = profiles.map((profile) =>
    profile.id === activeProfileId ? { ...profile, ...patch } : profile
  )
  write(KEYS.profiles, JSON.stringify(next))
  useSettings.setState({ profiles: next })
}

export const useSettings = create<Settings>(() => {
  const flat = readFlat()
  const profiles = initialProfiles(flat)
  const savedActive = read(KEYS.activeProfileId)
  const active = profiles.find((profile) => profile.id === savedActive) ?? profiles[0]
  return {
    locale: initialLocale(),
    location: initialLocation(),
    themePreference: initialThemePreference(),
    ttsVoice: initialTtsVoice(),
    thinking: read(KEYS.thinking) === 'true',
    search: read(KEYS.search) === 'true',
    siderCollapsed: read(KEYS.siderCollapsed) === 'true',
    customInstructions: read(KEYS.customInstructions) ?? '',
    memoryEnabled: read(KEYS.memoryEnabled) !== 'false',
    memories: readJson(KEYS.memories, [], normalizeMemories),
    ...flat,
    profiles,
    activeProfileId: active.id,
  }
})

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
  syncActiveProfile({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setCustomInstructions = (customInstructions: string) => {
  write(KEYS.customInstructions, customInstructions)
  useSettings.setState({ customInstructions })
}

export const setMemoryEnabled = (memoryEnabled: boolean) => {
  write(KEYS.memoryEnabled, String(memoryEnabled))
  useSettings.setState({ memoryEnabled })
}

/** 记忆列表整体替换：增删与去重逻辑在 services/memory.ts 里 */
export const setMemories = (memories: MemoryItem[]) => {
  write(KEYS.memories, JSON.stringify(memories))
  useSettings.setState({ memories })
}

export const setApiConfig = (patch: {
  apiPreset?: string
  apiBaseUrl?: string
  apiModel?: string
  apiProtocol?: ApiProtocol | ''
}) => {
  if (patch.apiPreset !== undefined) {
    write(KEYS.apiPreset, patch.apiPreset)
  }
  if (patch.apiBaseUrl !== undefined) {
    write(KEYS.apiBaseUrl, patch.apiBaseUrl)
  }
  if (patch.apiModel !== undefined) {
    write(KEYS.apiModel, patch.apiModel)
  }
  if (patch.apiProtocol !== undefined) {
    write(KEYS.apiProtocol, patch.apiProtocol)
  }
  useSettings.setState(patch)
  syncActiveProfile(patch)
}

export const setImageConfig = (patch: {
  imageBaseUrl?: string
  imageModel?: string
  imageApiKey?: string
  imageRefMode?: ImageRefMode
  imagePath?: string
}) => {
  if (patch.imageRefMode !== undefined) {
    write(KEYS.imageRefMode, patch.imageRefMode)
  }
  if (patch.imagePath !== undefined) {
    write(KEYS.imagePath, patch.imagePath)
  }
  if (patch.imageBaseUrl !== undefined) {
    write(KEYS.imageBaseUrl, patch.imageBaseUrl)
  }
  if (patch.imageModel !== undefined) {
    write(KEYS.imageModel, patch.imageModel)
  }
  if (patch.imageApiKey !== undefined) {
    write(KEYS.imageApiKey, patch.imageApiKey)
  }
  useSettings.setState(patch)
  syncActiveProfile(patch)
}

export const setImageExtra = (imageExtra: string) => {
  write(KEYS.imageExtra, imageExtra)
  useSettings.setState({ imageExtra })
  syncActiveProfile({ imageExtra })
}

export const setChatParams = (patch: Partial<ChatParams>) => {
  const chatParams = { ...useSettings.getState().chatParams, ...patch }
  write(KEYS.chatParams, JSON.stringify(chatParams))
  useSettings.setState({ chatParams })
  syncActiveProfile({ chatParams })
}

/** 切换配置档案：把该档案的接口与参数整体套用到当前设置 */
export const switchProfile = (id: string) => {
  const profile = useSettings.getState().profiles.find((item) => item.id === id)
  if (!profile) {
    return
  }
  write(KEYS.apiKey, profile.apiKey)
  write(KEYS.apiPreset, profile.apiPreset)
  write(KEYS.apiBaseUrl, profile.apiBaseUrl)
  write(KEYS.apiModel, profile.apiModel)
  write(KEYS.apiProtocol, profile.apiProtocol)
  write(KEYS.imageBaseUrl, profile.imageBaseUrl)
  write(KEYS.imageModel, profile.imageModel)
  write(KEYS.imageApiKey, profile.imageApiKey)
  write(KEYS.imageExtra, profile.imageExtra)
  write(KEYS.imageRefMode, profile.imageRefMode)
  write(KEYS.imagePath, profile.imagePath)
  write(KEYS.chatParams, JSON.stringify(profile.chatParams))
  write(KEYS.activeProfileId, id)
  useSettings.setState({
    activeProfileId: id,
    apiKey: profile.apiKey,
    apiPreset: profile.apiPreset,
    apiBaseUrl: profile.apiBaseUrl,
    apiModel: profile.apiModel,
    apiProtocol: profile.apiProtocol,
    imageBaseUrl: profile.imageBaseUrl,
    imageModel: profile.imageModel,
    imageApiKey: profile.imageApiKey,
    imageExtra: profile.imageExtra,
    imageRefMode: profile.imageRefMode,
    imagePath: profile.imagePath,
    chatParams: profile.chatParams,
  })
}

/** 以当前设置为基础复制一份新档案 */
export const createProfile = (name: string) => {
  const state = useSettings.getState()
  const profile: EndpointProfile = {
    id: createId(),
    name,
    apiPreset: state.apiPreset,
    apiBaseUrl: state.apiBaseUrl,
    apiModel: state.apiModel,
    apiProtocol: state.apiProtocol,
    apiKey: state.apiKey,
    imageBaseUrl: state.imageBaseUrl,
    imageModel: state.imageModel,
    imageApiKey: state.imageApiKey,
    imageExtra: state.imageExtra,
    imageRefMode: state.imageRefMode,
    imagePath: state.imagePath,
    chatParams: state.chatParams,
  }
  const profiles = [...state.profiles, profile]
  write(KEYS.profiles, JSON.stringify(profiles))
  write(KEYS.activeProfileId, profile.id)
  useSettings.setState({ profiles, activeProfileId: profile.id })
}

export const renameProfile = (id: string, name: string) => {
  const profiles = useSettings
    .getState()
    .profiles.map((profile) => (profile.id === id ? { ...profile, name } : profile))
  write(KEYS.profiles, JSON.stringify(profiles))
  useSettings.setState({ profiles })
}

/** 删除档案；删掉当前档案时自动切到第一套 */
export const deleteProfile = (id: string) => {
  const state = useSettings.getState()
  const profiles = state.profiles.filter((profile) => profile.id !== id)
  if (profiles.length === 0) {
    return
  }
  write(KEYS.profiles, JSON.stringify(profiles))
  useSettings.setState({ profiles })
  if (state.activeProfileId === id) {
    switchProfile(profiles[0].id)
  }
}
