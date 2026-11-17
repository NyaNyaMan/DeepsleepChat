import { closeSettings, useSettingsDialog } from '../components/settings/settingsDialogState.js'
import { closeSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'
import { checkForUpdate } from '../services/updater.js'

/**
 * 安卓容器适配层。
 *
 * 网页在浏览器里运行时这里什么都不做，所有改动对原有网页行为没有影响；
 * 打包进 App（WebView）时补上浏览器与 WebView 之间缺失的几处等价能力：
 * - 下载：导出聊天记录用的 <a download> 在 WebView 里不会触发下载，改为交给原生写入文件
 * - window.open：引用链接、附件预览改为用系统浏览器打开
 * - 返回键：优先收起抽屉、关闭弹层，再退出应用
 * - 状态栏：跟随页面深浅色变化
 * - 麦克风：先由原生申请系统权限，再让网页采集，避免权限弹窗打断采集请求
 */

type AndroidHost = {
  beginSave: (name: string, mime: string) => boolean
  appendSave: (chunk: string) => boolean
  finishSave: () => string | null
  cancelSave: () => void
  openExternal: (url: string) => void
  ensureMicPermission: () => void
  setChromeColor: (color: string, dark: boolean) => void
  toast: (message: string) => void
}

/** 单块 base64 的大小，控制在 1MB 以内，避免安卓侧一次解码占用过多内存 */
const CHUNK_SIZE = 384 * 1024

const host = (window as unknown as { AndroidHost?: AndroidHost }).AndroidHost

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })

/** 分块把 Blob 交给原生写入「下载」目录，返回保存后的位置 */
const saveBlob = async (name: string, blob: Blob): Promise<string | null> => {
  if (!host || !host.beginSave(name, blob.type || 'application/octet-stream')) {
    return null
  }
  try {
    for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
      const dataUrl = await readAsDataUrl(blob.slice(offset, offset + CHUNK_SIZE))
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      if (!host.appendSave(base64)) {
        host.cancelSave()
        return null
      }
    }
    return host.finishSave()
  } catch {
    host.cancelSave()
    return null
  }
}

/** 拦截带 download 属性的链接（导出聊天记录），包括未插入 DOM 的临时链接 */
const interceptDownloads = () => {
  const nativeClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    const download = this.getAttribute('download')
    const href = this.href
    if (download === null || !href) {
      nativeClick.call(this)
      return
    }
    void (async () => {
      try {
        const response = await fetch(href)
        const blob = await response.blob()
        const saved = await saveBlob(download || 'download', blob)
        if (!saved) {
          host?.toast('保存失败，请重试')
        }
      } catch {
        host?.toast('保存失败，请重试')
      }
    })()
  }
}

const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'application/pdf': 'pdf',
}

/** 附件原件是 IndexedDB 里的 Blob，只能在新标签页里预览；App 内改为存到系统「下载」目录 */
const saveLocalBlob = async (href: string) => {
  try {
    const blob = await (await fetch(href)).blob()
    const extension = MIME_EXTENSION[blob.type] ?? 'bin'
    const name = `attachment-${Date.now()}.${extension}`
    // 保存结果由原生侧统一 toast 提示
    await saveBlob(name, blob)
  } catch {
    host?.toast('保存失败，请重试')
  }
}

const interceptWindowOpen = () => {
  window.open = ((url?: string | URL) => {
    const href = typeof url === 'string' ? url : url?.toString()
    if (!href) {
      return null
    }
    if (href.startsWith('blob:')) {
      void saveLocalBlob(href)
    } else {
      host?.openExternal(href)
    }
    return null
  }) as typeof window.open
}

/** 等待原生返回的系统麦克风权限结果；同一时间只会有一次申请 */
let micPermission: Promise<boolean> | null = null

const requestMicPermission = (): Promise<boolean> => {
  if (micPermission) {
    return micPermission
  }
  micPermission = new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (granted: boolean) => {
      if (settled) {
        return
      }
      settled = true
      micPermission = null
      window.__hostMicResult = undefined
      resolve(granted)
    }
    window.__hostMicResult = finish
    host?.ensureMicPermission()
    // 原生端异常时不要一直卡住，交给采集本身去报错
    setTimeout(() => finish(true), 20000)
  })
  return micPermission
}

/**
 * getUserMedia 前先由原生拿到系统权限，再去采集。
 *
 * WebView 里如果先发起采集、再弹系统权限框，Activity 会进入 paused，
 * 挂起的采集请求可能被中断，网页只能拿到一个笼统的失败；把顺序调过来就不会被打断。
 */
const patchGetUserMedia = () => {
  const mediaDevices = navigator.mediaDevices
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
    return
  }
  const nativeGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices)
  mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
    if (!(await requestMicPermission())) {
      throw new DOMException('Microphone permission denied', 'NotAllowedError')
    }
    try {
      return await nativeGetUserMedia(constraints)
    } catch (error) {
      // 少数机型在权限弹窗收起后仍会中断一次采集，稍等重试一次
      if (
        error instanceof DOMException &&
        (error.name === 'AbortError' || error.name === 'NotReadableError')
      ) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        return nativeGetUserMedia(constraints)
      }
      throw error
    }
  }
}

/** 返回键：先关闭最上层界面，返回 false 表示交给系统退出应用 */
const installBackHandler = () => {
  Object.defineProperty(window, '__hostBack', {
    value: () => {
      if (useMobileSider.getState().open) {
        closeMobileSider()
        return true
      }
      if (useSettingsDialog.getState().open) {
        closeSettings()
        return true
      }
      if (useSearchPanel.getState().entry !== null) {
        closeSearchPanel()
        return true
      }
      return false
    },
    configurable: true,
  })
}

const toHexColor = (value: string) => {
  const parts = value.match(/[\d.]+/g)
  if (!parts || parts.length < 3) {
    return null
  }
  return `#${parts
    .slice(0, 3)
    .map((part) => Math.round(Number(part)).toString(16).padStart(2, '0'))
    .join('')}`
}

/** 状态栏、导航栏与页面背景同色，切换深浅色时同步 */
const syncSystemBars = () => {
  const body = document.body
  const color = toHexColor(getComputedStyle(body).backgroundColor)
  if (!color) {
    return
  }
  host?.setChromeColor(color, body.classList.contains('dark'))
}

const observeTheme = () => {
  syncSystemBars()
  window.addEventListener('load', syncSystemBars)
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => setTimeout(syncSystemBars, 0))
  new MutationObserver(syncSystemBars).observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'data-ds-dark-theme'],
  })
}

export const setupNativeHost = () => {
  if (!host) {
    return
  }
  interceptDownloads()
  interceptWindowOpen()
  patchGetUserMedia()
  installBackHandler()
  observeTheme()
  // 启动后静默查一次更新（24 小时内不重复），失败不打扰用户
  window.setTimeout(() => {
    void checkForUpdate(false)
  }, 3000)
}

declare global {
  interface Window {
    __hostBack?: () => boolean
    /** 原生申请完系统麦克风权限后回调 */
    __hostMicResult?: (granted: boolean) => void
  }
}
