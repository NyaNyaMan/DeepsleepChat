import { create } from 'zustand'
import { translate, type TranslationKey } from '../i18n/index.js'
import { showToast } from '../components/base/toastState.js'
import { httpText } from './nativeHttp.js'

/**
 * 应用内更新。
 *
 * 流程：读 GitHub Releases 最新条目 → 比较 versionCode → 下载交给原生 →
 * 原生校验包名/版本/签名后回调 ready → 由用户点「安装」调起系统安装器。
 * 浏览器里没有原生桥，只显示「仅安卓 App 可用」。
 */

type HostUpdate = {
  versionCode?: () => number
  versionName?: () => string
  downloadUpdate?: (url: string) => void
  installUpdate?: () => string
  updateState?: () => string
}

export type UpdatePhase =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'

type UpdateState = {
  phase: UpdatePhase
  version: string | null
  url: string | null
  error: string | null
}

/** 延迟读取：WebView 在页面脚本执行前注入，这里仍按调用时取，避免模块加载顺序的影响 */
const host = () => (window as unknown as { AndroidHost?: HostUpdate }).AndroidHost

const RELEASES_API = 'https://api.github.com/repos/NyaNyaMan/DeepsleepChat/releases/latest'
/** 自动检查的间隔，手动点按钮不受限制 */
const CHECK_INTERVAL = 24 * 60 * 60 * 1000
const CHECKED_AT_KEY = 'chat-demo:update-checked-at'

export const useUpdate = create<UpdateState>(() => ({
  phase: 'idle',
  version: null,
  url: null,
  error: null,
}))

const setPhase = (phase: UpdatePhase, patch: Partial<UpdateState> = {}) => {
  useUpdate.setState({ phase, ...patch })
}

export const isUpdateSupported = () => typeof host()?.versionCode === 'function'

export const currentVersion = () => {
  try {
    return host()?.versionName?.() ?? ''
  } catch {
    return ''
  }
}

const parseVersionCode = (body: string): number | null => {
  const matched = /versionCode\s*[=:]\s*(\d+)/i.exec(body)
  return matched ? Number(matched[1]) : null
}

const toNumbers = (value: string) =>
  value
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map((part) => Number.parseInt(part, 10) || 0)

/** 没有 versionCode 时退回比较版本号，如 v1.5.0 与 1.4.1 */
const isNewerTag = (tag: string, local: string): boolean => {
  const remote = toNumbers(tag)
  const mine = toNumbers(local)
  for (let i = 0; i < Math.max(remote.length, mine.length); i += 1) {
    const a = remote[i] ?? 0
    const b = mine[i] ?? 0
    if (a !== b) {
      return a > b
    }
  }
  return false
}

type ReleaseAsset = { name?: string; browser_download_url?: string }
type Release = { tag_name?: string; body?: string; assets?: ReleaseAsset[] }

const findApk = (release: Release): string | null => {
  const asset = (release.assets ?? []).find(
    (item) => typeof item.name === 'string' && /\.apk$/i.test(item.name)
  )
  return asset?.browser_download_url ?? null
}

const recentlyChecked = (): boolean => {
  const last = Number(localStorage.getItem(CHECKED_AT_KEY) ?? 0)
  return Number.isFinite(last) && Date.now() - last < CHECK_INTERVAL
}

const errorText = (error: TranslationKey) => translate(error)

/** 读取原生已下载状态，进入设置页时调用 */
export const refreshUpdateState = () => {
  const native = host()
  if (!native?.updateState) {
    return
  }
  try {
    const state = native.updateState()
    if (state === 'ready') {
      setPhase('ready')
    } else if (state === 'downloading') {
      setPhase('downloading')
    } else if (state === 'idle' && useUpdate.getState().phase === 'ready') {
      // 安装包被清理或已经装上，避免一直显示「已下载」
      setPhase('idle')
    }
  } catch {
    // 状态读取失败不打扰用户
  }
}

export const checkForUpdate = async (manual = false): Promise<void> => {
  if (!isUpdateSupported()) {
    setPhase('unsupported')
    return
  }
  if (!manual && recentlyChecked()) {
    return
  }
  // 已经下载好待安装时不要被自动检查覆盖成「发现新版本」
  if (!manual && useUpdate.getState().phase === 'ready') {
    return
  }
  setPhase('checking', { error: null })
  try {
    const response = await httpText(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) {
      throw new Error(`GitHub ${response.status}`)
    }
    const release = JSON.parse(response.text) as Release
    const apkUrl = findApk(release)
    if (!apkUrl) {
      throw new Error('no apk asset')
    }
    localStorage.setItem(CHECKED_AT_KEY, String(Date.now()))
    const remoteCode = parseVersionCode(release.body ?? '')
    const localCode = host()?.versionCode?.() ?? 0
    const newer =
      remoteCode === null
        ? isNewerTag(release.tag_name ?? '', currentVersion())
        : remoteCode > localCode
    if (!newer) {
      setPhase('latest', { version: release.tag_name ?? null, url: null })
      return
    }
    setPhase('available', { version: release.tag_name ?? null, url: apkUrl })
    if (!manual) {
      showToast(
        translate('updateAvailable', { version: release.tag_name ?? '' })
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setPhase('error', { error: manual ? message : null })
    if (manual) {
      showToast(errorText('updateFailed'))
    }
  }
}

export const downloadUpdate = (): void => {
  const { url } = useUpdate.getState()
  const native = host()
  if (!url || !native?.downloadUpdate) {
    return
  }
  setPhase('downloading', { error: null })
  try {
    native.downloadUpdate(url)
  } catch (error) {
    setPhase('error', { error: error instanceof Error ? error.message : null })
  }
}

/** 返回给界面的结果码，文案由调用方翻译 */
export const installUpdate = (): string => {
  try {
    return host()?.installUpdate?.() ?? 'missing'
  } catch {
    return 'noinstaller'
  }
}

/** 原生下载完成/失败时回调 */
const handleHostEvent = (raw: string) => {
  try {
    const event = JSON.parse(raw) as { state?: string; message?: string }
    if (event.state === 'ready') {
      setPhase('ready', { error: null })
      showToast(translate('updateReady'))
    } else if (event.state === 'error') {
      setPhase('error', { error: event.message ?? null })
      showToast(event.message || errorText('updateFailed'))
    } else if (event.state === 'downloading') {
      setPhase('downloading')
    }
  } catch {
    // 忽略格式异常的回调
  }
}

if (typeof window !== 'undefined') {
  window.__hostUpdate = handleHostEvent
}

declare global {
  interface Window {
    /** 原生更新下载状态回调，参数为 JSON 字符串 */
    __hostUpdate?: (raw: string) => void
  }
}
