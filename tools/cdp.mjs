// 用 CDP 驱动本机 Chrome，在移动端视口下做布局测量与截图。
// 用法: node tools/cdp.mjs <url> <out.png> <width> <height> [evalExpr] [mock]
//   evalExpr 在页面加载后执行；mock=1 时把 DeepSeek 接口替换成本地假流，便于离线验收聊天界面
import { spawn } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const [, , url, out, w = '390', h = '844', expr = '', mock = '', expr2 = ''] = process.argv
const port = 9333 + Math.floor(Math.random() * 200)
const profile = mkdtempSync(path.join(tmpdir(), 'cdp-'))
// 默认 Windows 的 Chrome 路径，可用 CHROME_PATH 覆盖
const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const mockSource = `
(() => {
  const reply = [
    '你好！这是运行在安卓端的**流式回复**测试。',
    '',
    '1. Markdown 正常渲染',
    '2. 代码块可以横向滚动',
    '',
    '\`\`\`js',
    "console.log('hello from webview')",
    '\`\`\`',
    '',
    '| 能力 | 状态 |',
    '| --- | --- |',
    '| 流式输出 | 正常 |',
    '| 附件上传 | 正常 |',
  ].join('\\n')

  const events = []
  const push = (type, data) => events.push('event: ' + type + '\\ndata: ' + JSON.stringify(data) + '\\n\\n')
  push('message_start', { type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', model: 'deepseek-chat', content: [], stop_reason: null, usage: { input_tokens: 18, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } })
  push('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  for (let i = 0; i < reply.length; i += 6) {
    push('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply.slice(i, i + 6) } })
  }
  push('content_block_stop', { type: 'content_block_stop', index: 0 })
  push('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 18, output_tokens: 96, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } })
  push('message_stop', { type: 'message_stop' })

  const originalFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const target = typeof input === 'string' ? input : (input && input.url) || ''
    if (target.includes('/anthropic/v1/messages')) {
      const body = events.join('')
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          for (let i = 0; i < body.length; i += 48) {
            controller.enqueue(encoder.encode(body.slice(i, i + 48)))
            await new Promise((resolve) => setTimeout(resolve, 30))
          }
          controller.close()
        },
      })
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    }
    if (target.endsWith('/models')) {
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    return originalFetch(input, init)
  }
})()
`

const child = spawn(
  chrome,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const getJson = async (p) => {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${p}`)
      if (res.ok) return await res.json()
    } catch {}
    await sleep(200)
  }
  throw new Error('devtools not ready')
}

const main = async () => {
  const version = await getJson('/json/version')
  const ws = new WebSocket(version.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  })
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params, sessionId }))
    })

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const s = (m, p) => send(m, p, sessionId)

  await s('Page.enable')
  await s('Runtime.enable')
  await s('Emulation.setDeviceMetricsOverride', {
    width: Number(w),
    height: Number(h),
    deviceScaleFactor: 2,
    mobile: true,
  })
  await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  if (mock) {
    await s('Page.addScriptToEvaluateOnNewDocument', { source: mockSource })
  }
  await s('Page.navigate', { url })
  await sleep(3500)

  if (expr) {
    const result = await s('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    })
    console.log('EVAL:', JSON.stringify(result.result?.value ?? result, null, 2))
    await sleep(1500)
  }

  if (expr2) {
    const result = await s('Runtime.evaluate', {
      expression: expr2,
      returnByValue: true,
      awaitPromise: true,
    })
    console.log('EVAL2:', JSON.stringify(result.result?.value ?? result, null, 2))
    await sleep(4000)
  }

  const shot = await s('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log('SHOT:', out)

  ws.close()
  child.kill()
  process.exit(0)
}

main().catch((err) => {
  console.error('FAILED', err)
  child.kill()
  process.exit(1)
})
