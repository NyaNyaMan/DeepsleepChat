import { translate, type TranslationMessage } from '../../i18n/index.js'
import { useSettings, type ChatParams } from '../settings.js'
import { readMessageEvent } from './parseEvent.js'
import { resolveEndpoint, type ResolvedEndpoint } from './providers.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageParam,
  MessageStreamEvent,
} from './types.js'

/** 主模型的自定义参数：协议里的字段名不同，这里统一映射 */
const chatParamBody = (params: ChatParams): Record<string, number> => ({
  ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
  ...(params.topP !== undefined ? { top_p: params.topP } : {}),
  ...(params.maxTokens !== undefined ? { max_tokens: params.maxTokens } : {}),
})

/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** 用 GET /models 校验 API Key（不产生费用）；第三方接口没有统一校验端时直接跳过 */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  const { modelsUrl } = resolveEndpoint()
  if (!modelsUrl) {
    return
  }
  await request(modelsUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
}

/**
 * POST {filesBase} 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const { filesBase } = resolveEndpoint()
  if (!filesBase) {
    throw new ApiError('http', { key: 'apiFilesUnsupported' })
  }
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(filesBase, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE {filesBase}/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  const { filesBase } = resolveEndpoint()
  if (!filesBase) {
    return
  }
  await request(`${filesBase}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * 对话流式接口：按当前接口配置分发到 Anthropic 兼容或 OpenAI 兼容实现。
 * 两者都产出同一套 MessageStreamEvent，上层渲染与会话逻辑不需要区分。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const endpoint = resolveEndpoint()
  if (endpoint.protocol === 'openai') {
    yield* streamOpenAiCompatible(apiKey, body, signal, endpoint)
    return
  }
  yield* streamAnthropicCompatible(apiKey, body, signal, endpoint)
}

/** DeepSeek 的 Anthropic 兼容接口：直接透传流式事件 */
async function* streamAnthropicCompatible(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  endpoint: ResolvedEndpoint
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(endpoint.chatUrl, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      ...body,
      model: endpoint.model,
      stream: true,
      ...chatParamBody(useSettings.getState().chatParams),
    }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}

// ---------------------------------------------------------------- OpenAI 兼容

type OpenAiMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type OpenAiStreamChunk = {
  choices?: {
    delta?: { content?: string | null; reasoning_content?: string | null }
    finish_reason?: string | null
  }[]
  error?: { message?: string }
}

/**
 * Anthropic 风格的消息体转成 OpenAI chat/completions：
 * latest_reminder 这类扩展角色并进下一条用户消息；附件块在 OpenAI 协议下无法引用，直接略过。
 */
const toOpenAiMessages = (body: CreateMessageRequest): OpenAiMessage[] => {
  const messages: OpenAiMessage[] = []
  if (body.system) {
    messages.push({ role: 'system', content: body.system })
  }
  let reminder = ''
  for (const message of body.messages as MessageParam[]) {
    if (message.role === 'latest_reminder') {
      reminder = reminder ? `${reminder}\n${message.content}` : message.content
      continue
    }
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
            .map((block) => block.text)
            .join('\n')
    if (!text.trim()) {
      continue
    }
    if (message.role === 'user' && reminder) {
      messages.push({ role: 'user', content: `${reminder}\n\n${text}` })
      reminder = ''
      continue
    }
    messages.push({ role: message.role, content: text })
  }
  return messages
}

/** 把 OpenAI 的增量流翻译成项目内部使用的事件序列 */
async function* streamOpenAiCompatible(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal,
  endpoint: ResolvedEndpoint
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(endpoint.chatUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model: endpoint.model,
      messages: toOpenAiMessages(body),
      stream: true,
      ...chatParamBody(useSettings.getState().chatParams),
    }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  yield {
    type: 'message_start',
    message: {
      id: 'openai-stream',
      role: 'assistant',
      model: endpoint.model,
      content: [],
    },
  } as MessageStreamEvent

  const openBlocks = new Map<'thinking' | 'text', number>()
  let nextIndex = 0
  const openBlock = (kind: 'thinking' | 'text'): number => {
    const existing = openBlocks.get(kind)
    if (existing !== undefined) {
      return existing
    }
    const index = nextIndex++
    openBlocks.set(kind, index)
    return index
  }

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data === '[DONE]') {
      break
    }
    let payload: OpenAiStreamChunk
    try {
      payload = JSON.parse(data) as OpenAiStreamChunk
    } catch {
      continue
    }
    if (payload.error?.message) {
      throw new ApiError('stream', payload.error.message)
    }
    const delta = payload.choices?.[0]?.delta
    if (!delta) {
      continue
    }
    if (delta.reasoning_content) {
      const fresh = !openBlocks.has('thinking')
      const index = openBlock('thinking')
      if (fresh) {
        yield {
          type: 'content_block_start',
          index,
          content_block: { type: 'thinking', thinking: '' },
        } as MessageStreamEvent
      }
      yield {
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: delta.reasoning_content },
      } as MessageStreamEvent
    }
    if (delta.content) {
      const fresh = !openBlocks.has('text')
      const index = openBlock('text')
      if (fresh) {
        yield {
          type: 'content_block_start',
          index,
          content_block: { type: 'text', text: '' },
        } as MessageStreamEvent
      }
      yield {
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: delta.content },
      } as MessageStreamEvent
    }
  }

  for (const index of openBlocks.values()) {
    yield { type: 'content_block_stop', index } as MessageStreamEvent
  }
  yield { type: 'message_stop' } as MessageStreamEvent
}

// ---------------------------------------------------------------- 非流式补全

/**
 * 一次性补全（不流式）：长期记忆抽取、生图提示词润色这类内部调用使用。
 * 非 DeepSeek 接口同样可用，按当前协议发送。
 */
export const completeText = async (
  apiKey: string,
  {
    system,
    prompt,
    maxTokens = 512,
    signal,
  }: { system: string; prompt: string; maxTokens?: number; signal?: AbortSignal }
): Promise<string> => {
  const endpoint = resolveEndpoint()
  if (endpoint.protocol === 'anthropic') {
    const response = await request(endpoint.chatUrl, {
      method: 'POST',
      headers: {
        ...anthropicHeaders(apiKey, false),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: endpoint.model,
        system,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal,
    })
    const body = (await response.json()) as { content?: { type?: string; text?: string }[] }
    return (body.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
      .trim()
  }

  const response = await request(endpoint.chatUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: endpoint.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
    }),
    signal,
  })
  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  return (body.choices?.[0]?.message?.content ?? '').trim()
}
