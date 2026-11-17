/**
 * 统一的 HTTP 出口。
 *
 * 安卓容器里通过 window.AndroidHost.httpRequestAsync 走原生请求，绕开 WebView 的
 * 同源策略——第三方接口（生图、模型列表）大多不返回 CORS 头，网页直接 fetch 会
 * 抛 "Failed to fetch"。浏览器里退回普通 fetch。
 */

type AndroidHostHttp = {
  httpRequestAsync?: (
    id: string,
    method: string,
    url: string,
    headersJson: string,
    body: string
  ) => void
  /** multipart/form-data：图片编辑类接口只能这样传二进制参考图 */
  httpMultipartAsync?: (id: string, url: string, headersJson: string, partsJson: string) => void
}

type BridgeResult = { status?: number; body?: string; error?: string }

export type HttpTextResult = { ok: boolean; status: number; text: string }

export type HttpTextInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

const host = (window as unknown as { AndroidHost?: AndroidHostHttp }).AndroidHost

/** 生图可能排队几十秒，给足时间 */
const TIMEOUT_MS = 180_000

let seq = 0
const pending = new Map<string, (result: BridgeResult) => void>()

const ensureReceiver = () => {
  if (window.__hostHttpResult) {
    return
  }
  window.__hostHttpResult = (id: string, raw: string) => {
    const settle = pending.get(id)
    if (!settle) {
      return
    }
    pending.delete(id)
    try {
      settle(JSON.parse(raw) as BridgeResult)
    } catch {
      settle({ status: 0, error: 'invalid bridge response' })
    }
  }
}

const toResult = (result: BridgeResult): HttpTextResult => {
  if (result.error) {
    throw new TypeError(result.error)
  }
  const status = result.status ?? 0
  return { ok: status >= 200 && status < 300, status, text: result.body ?? '' }
}

/** 走原生桥：注册回调、超时兜底，具体发什么由 dispatch 决定 */
const callBridge = (dispatch: (id: string) => void): Promise<HttpTextResult> =>
  new Promise<HttpTextResult>((resolve, reject) => {
    ensureReceiver()
    const id = `http-${++seq}`
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        reject(new TypeError('request timeout'))
      }
    }, TIMEOUT_MS)
    pending.set(id, (result) => {
      clearTimeout(timer)
      try {
        resolve(toResult(result))
      } catch (error) {
        reject(error)
      }
    })
    dispatch(id)
  })

export const httpText = async (url: string, init: HttpTextInit = {}): Promise<HttpTextResult> => {
  const method = (init.method ?? 'GET').toUpperCase()

  const send = host?.httpRequestAsync
  if (send) {
    return callBridge((id) =>
      send.call(host, id, method, url, JSON.stringify(init.headers ?? {}), init.body ?? '')
    )
  }

  const response = await fetch(url, {
    method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  })
  return { ok: response.ok, status: response.status, text: await response.text() }
}

/** 从接口返回里尽量抠出可读的错误信息 */
export const readErrorMessage = (text: string, fallback: string): string => {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
    if (typeof body.error === 'string') {
      return body.error
    }
    if (body.error?.message) {
      return body.error.message
    }
    if (typeof body.message === 'string') {
      return body.message
    }
  } catch {
    // 非 JSON 直接返回原文
  }
  return text.trim() || fallback
}

declare global {
  interface Window {
    __hostHttpResult?: (id: string, raw: string) => void
  }
}

export type MultipartFile = {
  /** 表单字段名，如 image / image[] */
  field: string
  name: string
  mime: string
  /** 不含 data: 前缀的 base64 */
  base64: string
}

export type MultipartInit = {
  fields: Record<string, string>
  files: MultipartFile[]
  headers?: Record<string, string>
  signal?: AbortSignal
}

const base64ToBlob = (base64: string, mime: string): Blob => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

/**
 * multipart/form-data 请求。容器里由原生拼包（JS 字符串传二进制会被 UTF-8 破坏），
 * 浏览器里用 FormData 直接提交。
 */
export const httpMultipart = async (url: string, init: MultipartInit): Promise<HttpTextResult> => {
  const send = host?.httpMultipartAsync
  if (send) {
    const parts = JSON.stringify({ fields: init.fields, files: init.files })
    return callBridge((id) => send.call(host, id, url, JSON.stringify(init.headers ?? {}), parts))
  }

  const form = new FormData()
  for (const [key, value] of Object.entries(init.fields)) {
    form.append(key, value)
  }
  for (const file of init.files) {
    form.append(file.field, base64ToBlob(file.base64, file.mime), file.name)
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: init.headers,
    body: form,
    signal: init.signal,
  })
  return { ok: response.ok, status: response.status, text: await response.text() }
}

/** 把 data URL 拆成 mime + base64，非 data URL 返回 null */
export const splitDataUrl = (src: string): { mime: string; base64: string; ext: string } | null => {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src)
  if (!match) {
    return null
  }
  const mime = match[1] || 'image/png'
  const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  if (match[2]) {
    return { mime, base64: match[3], ext }
  }
  return null
}
