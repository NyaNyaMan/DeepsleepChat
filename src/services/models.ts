import { ApiError, completeText } from './api/client.js'
import { resolveEndpoint } from './api/providers.js'
import { DEFAULT_IMAGE_PARAMS, generateImage, imageEndpoint } from './image.js'
import { httpText, readErrorMessage } from './nativeHttp.js'
import { useSettings } from './settings.js'

/**
 * 接口自检：模型列表、连通性测试，以及生图提示词的增强。
 * 所有请求都走 nativeHttp，容器内不受跨域限制。
 */

export type EndpointKind = 'chat' | 'image'

/** 模型列表地址与对应 Key：生图接口允许复用对话 Key */
const modelsTarget = (kind: EndpointKind): { url: string; key: string } => {
  const { apiKey, imageApiKey } = useSettings.getState()
  if (kind === 'image') {
    const base = imageEndpoint()
    if (!base) {
      throw new ApiError('http', { key: 'imageNotConfigured' })
    }
    return { url: `${base}/models`, key: imageApiKey.trim() || apiKey || '' }
  }
  const endpoint = resolveEndpoint()
  if (!endpoint.baseUrl) {
    throw new ApiError('http', { key: 'apiBaseUrlMissing' })
  }
  return {
    url: endpoint.modelsUrl ?? `${endpoint.baseUrl}/models`,
    key: apiKey ?? '',
  }
}

/** 拉取可用模型 id 列表（OpenAI 兼容的 GET /models） */
export const listModels = async (kind: EndpointKind): Promise<string[]> => {
  const { url, key } = modelsTarget(kind)
  let response
  try {
    response = await httpText(url, {
      method: 'GET',
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    })
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[models] request failed:', error)
    throw new ApiError('network', { key: 'connectionNetworkFailed' })
  }
  if (!response.ok) {
    throw new ApiError(
      'http',
      readErrorMessage(response.text, `HTTP ${response.status}`),
      response.status
    )
  }

  let body: { data?: { id?: string }[] }
  try {
    body = JSON.parse(response.text) as { data?: { id?: string }[] }
  } catch {
    throw new ApiError('protocol', { key: 'modelsEmpty' })
  }
  const ids = (body.data ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (ids.length === 0) {
    throw new ApiError('protocol', { key: 'modelsEmpty' })
  }
  return ids.sort((a, b) => a.localeCompare(b))
}

/**
 * 测试连接：
 * 先试 /models（同时校验地址与 Key）；不支持该端点的服务再退回到一次真实调用
 * ——对话发一条极短补全，生图则生成一张最小图。
 */
export const testConnection = async (kind: EndpointKind): Promise<void> => {
  try {
    await listModels(kind)
    return
  } catch (error) {
    const unsupported = error instanceof ApiError && (error.status === 404 || error.status === 405)
    if (!unsupported) {
      throw error
    }
  }

  if (kind === 'chat') {
    const { apiKey } = useSettings.getState()
    if (!apiKey) {
      throw new ApiError('http', { key: 'apiKeyStart' })
    }
    await completeText(apiKey, { system: 'ping', prompt: 'ping', maxTokens: 8 })
    return
  }

  await generateImage({
    prompt: 'a small blue circle on a white background',
    params: { ...DEFAULT_IMAGE_PARAMS, count: 1 },
    refs: [],
  })
}

const ENHANCE_SYSTEM_ZH =
  '你是文生图模型的提示词工程师。把用户的一句描述扩写成适合出图的中文提示词：包含主体、风格、构图、光线、色彩与画质细节，80 字以内，只输出提示词本身，不要解释。'

const ENHANCE_SYSTEM_EN =
  'You are a prompt engineer for text-to-image models. Expand the user description into a single vivid English prompt covering subject, style, composition, lighting, color and detail. Max 60 words, output the prompt only.'

/** 用主模型把一句话扩写成更完整的生图提示词 */
export const enhanceImagePrompt = async (prompt: string): Promise<string> => {
  const { apiKey, locale } = useSettings.getState()
  if (!apiKey) {
    throw new ApiError('http', { key: 'apiKeyStart' })
  }
  const english = locale === 'en-US'
  const text = await completeText(apiKey, {
    system: english ? ENHANCE_SYSTEM_EN : ENHANCE_SYSTEM_ZH,
    prompt: prompt.trim(),
    maxTokens: 400,
  })
  return text.trim()
}
