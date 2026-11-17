import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { setupNativeHost } from './app/native-host.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()
// 在安卓容器内接管下载、外链、返回键与状态栏；浏览器中为空操作
setupNativeHost()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
