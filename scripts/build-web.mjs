// 跨平台的生产构建脚本：npm run build 在各系统下行为一致。
// （原来的 `rm -rf dist && NODE_ENV=production rspack build` 依赖 POSIX shell，Windows 的 cmd 下会失败；
//  输出目录的清理交给 rspack 的 output.clean，无需额外删目录）
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['rspack', 'build', '-c', 'rspack.config.ts'],
  {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, NODE_ENV: 'production' },
  }
)

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
