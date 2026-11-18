import { ApiError } from './api/client.js'
import { httpMultipart, httpText, readErrorMessage, splitDataUrl } from './nativeHttp.js'
import { useSettings, type ImageRefMode } from './settings.js'

/**
 * 生图接口（OpenAI 兼容的 /images/generations）。
 * 与对话接口完全独立配置：可以指向另一家服务、另一个模型、另一个 Key。
 * 请求走 nativeHttp：容器内由原生代发，避开 CORS。
 */

export type ImageAspect = '1:1' | '3:4' | '4:3' | '16:9' | '9:16' | 'custom'
export type ImageResolution = '1K' | '2K' | '4K'

export type ImageParams = {
  /** 比例，custom 时用 width/height */
  aspect: ImageAspect
  width: number
  height: number
  /** 1K/2K/4K 决定长边像素，aspect 非 custom 时生效 */
  resolution: ImageResolution
  negativePrompt: string
  /** 一次生成几张（1-4） */
  count: number
  /** 随机种子，留空表示由服务端随机 */
  seed: number | null
  /** 参考图权重 0.2-1 */
  refWeight: number
  /** 额外请求参数（JSON），不同服务商的扩展字段放这里 */
  extra: string
}

export type ImageRef = { label: string; src: string }

/** 从 data URL 或图片地址推断扩展名，统一用无点形式（png/jpg/webp…） */
export const imageExtensionFromUrl = (url: string): string => {
  const data = splitDataUrl(url)
  if (data) {
    const subtype = data.mime.split('/')[1]?.toLowerCase() || 'png'
    return subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]/g, '') || 'png'
  }
  const match = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url)
  return match?.[1]?.toLowerCase() || 'png'
}

/** 生图结果的文件名：generated-YYYYMMDD-HHmmss-序号.ext */
export const generatedImageName = (url: string, stamp: string, index: number): string =>
  `generated-${stamp}-${index}.${imageExtensionFromUrl(url)}`

/** 把生成结果转成 Blob，供 Files API 作为图片输入上传；远程地址取不到时返回 null */
export const imageUrlToBlob = async (url: string): Promise<Blob | null> => {
  const data = splitDataUrl(url)
  if (data) {
    try {
      const binary = atob(data.base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
      }
      return new Blob([bytes], { type: data.mime })
    } catch {
      return null
    }
  }
  if (!/^https?:/i.test(url)) {
    return null
  }
  try {
    const response = await fetch(url)
    return response.ok ? await response.blob() : null
  } catch {
    return null
  }
}

export type ImageRequest = {
  /** 用户原始描述（展示与记录用） */
  prompt: string
  params: ImageParams
  refs: ImageRef[]
}

export type ImageResult = {
  /** 一次请求返回的图片，可能有多张 */
  urls: string[]
  /** 本次实际请求的尺寸，如 1:1 · 1024×1024 */
  size: string
  revisedPrompt?: string
}

export const DEFAULT_IMAGE_PARAMS: ImageParams = {
  aspect: '1:1',
  width: 1024,
  height: 1024,
  resolution: '1K',
  negativePrompt: '',
  count: 1,
  seed: null,
  refWeight: 0.6,
  extra: '',
}

export const ASPECTS: { value: Exclude<ImageAspect, 'custom'>; label: string }[] = [
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
  { value: '4:3', label: '4:3' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
]

const RATIOS: Record<Exclude<ImageAspect, 'custom'>, [number, number]> = {
  '1:1': [1, 1],
  '3:4': [3, 4],
  '4:3': [4, 3],
  '16:9': [16, 9],
  '9:16': [9, 16],
}

/** 长边像素：1K 约等于 1024，服务商大多要求 8 的倍数 */
const LONG_SIDE: Record<ImageResolution, number> = { '1K': 1024, '2K': 1536, '4K': 2048 }

const round8 = (value: number) => Math.max(256, Math.round(value / 8) * 8)

/** gpt-image 系列只接受这三档尺寸，其他尺寸会被上游直接拒绝 */
const snapGptImageSize = (width: number, height: number) => {
  if (width === height) {
    return { width: 1024, height: 1024 }
  }
  return width > height ? { width: 1536, height: 1024 } : { width: 1024, height: 1536 }
}

/** 按比例与分辨率算出实际宽高；custom 直接用用户填的值 */
export const resolveImageSize = (
  params: ImageParams
): { width: number; height: number; size: string; label: string } => {
  let width: number
  let height: number
  if (params.aspect === 'custom') {
    width = round8(params.width)
    height = round8(params.height)
  } else {
    const [w, h] = RATIOS[params.aspect]
    const long = LONG_SIDE[params.resolution]
    width = round8(w >= h ? long : (long * w) / h)
    height = round8(h >= w ? long : (long * h) / w)
  }
  if (useSettings.getState().imageModel.toLowerCase().includes('gpt-image')) {
    // 比例仍按用户选择判断横竖，像素强制落到 gpt-image 支持的档位
    const snapped = snapGptImageSize(width, height)
    width = snapped.width
    height = snapped.height
  }
  return {
    width,
    height,
    size: `${width}x${height}`,
    label: params.aspect === 'custom' ? `${width}×${height}` : `${params.aspect} · ${width}×${height}`,
  }
}

/** 是否已经配置好生图接口 */
export const imageReady = (): boolean => {
  const { imageBaseUrl, imageModel } = useSettings.getState()
  return Boolean(imageBaseUrl.trim() && imageModel.trim())
}

/** 生图接口地址（去掉结尾斜杠） */
export const imageEndpoint = (): string => {
  const { imageBaseUrl } = useSettings.getState()
  return imageBaseUrl.trim().replace(/\/+$/, '')
}

/** 生图用的 Key：没单独填就复用对话接口的 Key */
export const imageKey = (): string => {
  const { imageApiKey, apiKey } = useSettings.getState()
  return imageApiKey.trim() || apiKey || ''
}

/**
 * 把参考图编号写进提示词。模型只看得到文字，靠编号把「P1/P2」与图片顺序绑定；
 * 同时明确要求以参考图为准，避免模型把参考图当成可有可无的附加信息。
 */
export const composePrompt = ({ prompt, params, refs }: ImageRequest): string => {
  if (refs.length === 0) {
    return prompt
  }
  const labels = refs.map((ref) => ref.label).join('、')
  const mapping = refs.map((ref, index) => `${ref.label}=第${index + 1}张参考图`).join('，')
  const weight = params.refWeight >= 0.8 ? '高' : params.refWeight >= 0.5 ? '中' : '低'
  return [
    `【参考图】共 ${refs.length} 张，按上传顺序编号：${labels}（${mapping}）。`,
    `生成时必须参考这些图片的主体、构图与风格；文中出现某个编号时，指代该编号对应的参考图。参考图权重：${weight}（${params.refWeight.toFixed(1)}），权重越高越贴近参考图。`,
    prompt,
  ].join('\n')
}

/** 解析额外参数：非法 JSON 直接提示，不静默忽略 */
const parseExtra = (extra: string): Record<string, unknown> => {
  const text = extra.trim()
  if (!text) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 落到下面的统一报错
  }
  throw new ApiError('http', { key: 'imageExtraInvalid' })
}

/**
 * 参考图实际怎么发。auto 时按模型名推断：
 * gpt-image / dall-e-2 只有 /images/edits 支持参考图；dall-e-3 完全不支持；其余按 image 字段。
 */
export type RefPlan = {
  mode: Exclude<ImageRefMode, 'auto'>
  /** 完整请求地址 */
  url: string
  /** 模型名看起来不支持参考图（只提示，不阻止） */
  maybeUnsupported: boolean
}

const TEXT_ONLY_MODEL = /(dall-e-3|t2i|text2image|text-to-image)/

/** 用户显式填了路径就用它，否则按模式给默认路径 */
const resolvePath = (mode: Exclude<ImageRefMode, 'auto'>): string => {
  const custom = useSettings.getState().imagePath.trim()
  const path = custom || (mode === 'edits' ? '/images/edits' : '/images/generations')
  return path.startsWith('/') ? path : `/${path}`
}

export const resolveRefPlan = (): RefPlan => {
  const { imageModel, imageRefMode } = useSettings.getState()
  const model = imageModel.trim().toLowerCase()
  let mode: Exclude<ImageRefMode, 'auto'>
  if (imageRefMode === 'auto') {
    if (model.includes('gpt-image') || model.includes('dall-e-2')) {
      mode = 'edits'
    } else if (model.includes('dall-e-3')) {
      mode = 'off'
    } else {
      mode = 'image'
    }
  } else {
    mode = imageRefMode
  }
  return {
    mode,
    url: `${imageEndpoint()}${resolvePath(mode)}`,
    maybeUnsupported: TEXT_ONLY_MODEL.test(model),
  }
}

type ImageApiResponse = {
  data?: { url?: string; b64_json?: string; revised_prompt?: string }[]
  error?: { message?: string }
}

const parseResponse = (text: string, label: string): ImageResult => {
  let payload: ImageApiResponse
  try {
    payload = JSON.parse(text) as ImageApiResponse
  } catch {
    throw new ApiError('protocol', { key: 'imageFailed' })
  }
  const items = payload.data ?? []
  const urls = items.flatMap((item) => {
    if (item.url) {
      return [item.url]
    }
    return item.b64_json ? [`data:image/png;base64,${item.b64_json}`] : []
  })
  if (urls.length === 0) {
    throw new ApiError('protocol', payload.error?.message ?? { key: 'imageFailed' })
  }
  return { urls, size: label, revisedPrompt: items[0]?.revised_prompt }
}

/**
 * 接口错误里如果出现「image 不支持 / 无效」这类字样，说明参考图字段被拒了。
 * 这时给出可操作的指引，而不是把上游原文直接抛给用户。
 */
const errorFrom = (text: string, status: number, refsSent: boolean): ApiError => {
  const message = readErrorMessage(text, `HTTP ${status}`)
  if (
    refsSent &&
    /(参考图|image)/i.test(message) &&
    /(not support|unsupported|invalid|unknown|unexpected|不支持|无效|无法识别|多余)/i.test(message)
  ) {
    return new ApiError('http', { key: 'imageRefFieldRejected', params: { message } }, status)
  }
  return new ApiError('http', message, status)
}

const networkError = (error: unknown, signal?: AbortSignal): never => {
  if (signal?.aborted) {
    throw error
  }
  // eslint-disable-next-line no-console
  console.error('[image] request failed:', error)
  throw new ApiError('network', { key: 'imageNetworkFailed' })
}

/** 远程地址的参考图要变成字节才能 multipart 上传 */
const ensureDataUrl = async (
  src: string,
  signal?: AbortSignal
): Promise<{ mime: string; base64: string; ext: string }> => {
  const parsed = splitDataUrl(src)
  if (parsed) {
    return parsed
  }
  if (!src.startsWith('http')) {
    throw new ApiError('http', { key: 'imageRefUnreadable' })
  }
  try {
    const response = await fetch(src, { signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const blob = await response.blob()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? new Error('read failed'))
      reader.readAsDataURL(blob)
    })
    const converted = splitDataUrl(dataUrl)
    if (!converted) {
      throw new Error('convert failed')
    }
    return converted
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[image] download reference failed:', error)
    throw new ApiError('network', { key: 'imageRefUnreadable' })
  }
}

/** multipart 上传参考图（OpenAI /images/edits 系列） */
const requestEdits = async (
  request: ImageRequest,
  plan: RefPlan,
  size: string,
  label: string,
  signal?: AbortSignal
): Promise<ImageResult> => {
  const { params } = request
  const { imageModel } = useSettings.getState()
  const files = await Promise.all(request.refs.map((ref) => ensureDataUrl(ref.src, signal)))
  const fields: Record<string, string> = {
    model: imageModel.trim(),
    prompt: composePrompt(request),
    n: String(Math.min(4, Math.max(1, params.count))),
    size,
  }
  for (const [key, value] of Object.entries(parseExtra(params.extra))) {
    if (value !== null && typeof value !== 'object') {
      fields[key] = String(value)
    }
  }

  // 单张用 image，多张用 image[]（OpenAI 兼容网关的通用约定）
  const fileField = files.length > 1 ? 'image[]' : 'image'
  const response = await (async () => {
    try {
      return await httpMultipart(plan.url, {
        fields,
        files: files.map((file, index) => ({
          field: fileField,
          name: `p${index + 1}.${file.ext}`,
          mime: file.mime,
          base64: file.base64,
        })),
        headers: { Authorization: `Bearer ${imageKey()}` },
        signal,
      })
    } catch (error) {
      return networkError(error, signal)
    }
  })()

  if (!response.ok) {
    throw errorFrom(response.text, response.status, true)
  }
  return parseResponse(response.text, label)
}

/** 调用生图模型；失败时抛 ApiError，交给界面展示 */

/** 调用生图模型；失败时抛 ApiError，交给界面展示 */
export const generateImage = async (
  request: ImageRequest,
  signal?: AbortSignal
): Promise<ImageResult> => {
  const base = imageEndpoint()
  const { imageModel } = useSettings.getState()
  if (!base || !imageModel.trim()) {
    throw new ApiError('http', { key: 'imageNotConfigured' })
  }

  const { params } = request
  const { size, label } = resolveImageSize(params)
  const plan = resolveRefPlan()

  if (request.refs.length > 0 && plan.mode === 'edits') {
    return requestEdits(request, plan, size, label, signal)
  }

  // gpt-image 在 auto 下会得到 edits 计划；但纯文字生图没有图片，必须改走 generations，
  // 否则会把 JSON POST 到只接受 multipart 的 /images/edits（上游返回通用 request-id 错误）。
  const url =
    request.refs.length === 0 && plan.mode === 'edits'
      ? `${imageEndpoint()}${resolvePath('image')}`
      : plan.url

  const withRefs = request.refs.length > 0 && plan.mode !== 'off'
  const refValues = withRefs
    ? await Promise.all(
        request.refs.map(async (ref) => {
          if (plan.mode !== 'image-raw') {
            return ref.src
          }
          const parsed = splitDataUrl(ref.src)
          return parsed ? parsed.base64 : ref.src
        })
      )
    : []

  const gptImage = imageModel.toLowerCase().includes('gpt-image')
  const body: Record<string, unknown> = {
    model: imageModel.trim(),
    prompt: composePrompt(request),
    n: Math.min(4, Math.max(1, params.count)),
    size,
    // gpt-image 系列不认识这几个扩展字段，严格网关会直接 400
    ...(!gptImage && params.negativePrompt.trim()
      ? { negative_prompt: params.negativePrompt.trim() }
      : {}),
    ...(!gptImage && params.seed !== null ? { seed: params.seed } : {}),
    ...(withRefs
      ? {
          [plan.mode === 'image-url' ? 'image_url' : plan.mode === 'images' ? 'images' : 'image']:
            refValues,
          ...(gptImage ? {} : { image_weight: params.refWeight }),
        }
      : {}),
    ...parseExtra(params.extra),
  }

  const response = await (async () => {
    try {
      return await httpText(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${imageKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (error) {
      return networkError(error, signal)
    }
  })()

  if (!response.ok) {
    throw errorFrom(response.text, response.status, true)
  }
  return parseResponse(response.text, label)
}

/** 调用生图模型；失败时抛 ApiError，交给界面展示 */
