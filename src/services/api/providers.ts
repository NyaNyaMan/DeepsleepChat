import { useSettings, type ApiProtocol } from '../settings.js'

/**
 * 对话接口的服务商预设。
 *
 * baseUrl 是「接口前缀」：anthropic 协议拼 /messages、/files，openai 协议拼 /chat/completions。
 * native 表示该服务商同时提供 DeepSeek 的 Files 与语音工具接口（附件上传、语音输入、朗读依赖它）。
 */
export type ProviderPreset = {
  id: string
  label: string
  baseUrl: string
  protocol: ApiProtocol
  model: string
  native: boolean
  /** 控制面板地址，方便用户去拿 Key */
  keyUrl?: string
  hint?: string
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    baseUrl: 'https://api.deepseek.com/anthropic/v1',
    protocol: 'anthropic',
    model: 'deepseek-flash',
    native: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'openai',
    model: 'gpt-4o-mini',
    native: false,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    protocol: 'openai',
    model: 'moonshot-v1-8k',
    native: false,
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    protocol: 'openai',
    model: 'glm-4-flash',
    native: false,
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'siliconflow',
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    protocol: 'openai',
    model: 'deepseek-ai/DeepSeek-V3',
    native: false,
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    protocol: 'openai',
    model: 'deepseek/deepseek-chat',
    native: false,
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'custom',
    label: '自定义接口',
    baseUrl: '',
    protocol: 'openai',
    model: '',
    native: false,
    hint: '任何 OpenAI 兼容或 Anthropic 兼容的网关都可以，填到 /v1 为止',
  },
]

export const DEFAULT_PROVIDER = PROVIDERS[0]

export const findProvider = (id: string): ProviderPreset =>
  PROVIDERS.find((item) => item.id === id) ?? DEFAULT_PROVIDER

export type ResolvedEndpoint = {
  preset: ProviderPreset
  protocol: ApiProtocol
  baseUrl: string
  model: string
  /** 对话接口完整地址 */
  chatUrl: string
  /** 附件上传（仅 DeepSeek 官方） */
  filesBase: string | null
  /** API Key 校验地址 */
  modelsUrl: string | null
  /** 语音识别 / 合成接口前缀 */
  speechBase: string | null
}

const trimEnd = (value: string) => value.replace(/\/+$/, '')

/** 把 DeepSeek 的 anthropic 前缀还原成站点根，用于拼 /models 与 /v1/tools */
const nativeOrigin = (baseUrl: string) => baseUrl.replace(/\/anthropic(\/v1)?$/, '')

/** 按当前设置解析出实际使用的接口地址与协议 */
export const resolveEndpoint = (): ResolvedEndpoint => {
  const { apiPreset, apiBaseUrl, apiModel, apiProtocol } = useSettings.getState()
  const preset = findProvider(apiPreset)
  const baseUrl = trimEnd(apiBaseUrl.trim() || preset.baseUrl)
  const protocol = apiProtocol || preset.protocol
  const model = apiModel.trim() || preset.model
  const native = preset.native && protocol === 'anthropic'
  const origin = native ? nativeOrigin(baseUrl) : ''

  return {
    preset,
    protocol,
    baseUrl,
    model,
    chatUrl: protocol === 'anthropic' ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`,
    filesBase: native ? `${baseUrl}/files` : null,
    modelsUrl: native ? `${origin}/models` : null,
    speechBase: native ? `${origin}/v1/tools` : null,
  }
}

/** 自定义接口还没填全时给出提示，其余情况返回 null */
export const endpointIssue = (
  endpoint = resolveEndpoint()
): 'apiBaseUrlMissing' | 'apiModelMissing' | null => {
  if (!endpoint.baseUrl) {
    return 'apiBaseUrlMissing'
  }
  if (!endpoint.model) {
    return 'apiModelMissing'
  }
  return null
}

/** 语音输入、朗读、附件依赖 DeepSeek 官方接口 */
export const supportsNativeFeatures = () => resolveEndpoint().speechBase !== null
