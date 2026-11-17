// 一键打包：构建网页 → 复制进 assets → Gradle 打包 APK → 汇总到 build-output/
// 用法：npm run build:apk  （可选 --debug 打调试包）
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const androidDir = path.join(root, 'android')
const debug = process.argv.includes('--debug')
const variant = debug ? 'Debug' : 'Release'

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })
  if (result.status !== 0) {
    console.error(`\n[build-apk] 失败：${command} ${args.join(' ')}`)
    process.exit(result.status ?? 1)
  }
}

if (!process.env.JAVA_HOME && !process.env.JDK_HOME) {
  console.warn('[build-apk] 未检测到 JAVA_HOME，将使用 PATH 中的 java。Android Gradle Plugin 需要 JDK 17-21。')
}

console.log('[build-apk] 1/2 构建网页资源 ...')
run(process.execPath, [path.join(root, 'scripts', 'build-web.mjs')], root)

/**
 * release 包需要签名证书。keystore.properties 与证书都不进 git（见 .gitignore），
 * 首次打正式包时在本地生成一份演示证书，口令随机生成后只写进本地配置。
 * 要正式发布请替换为真实证书并更新该文件。
 */
const ensureSigningKeystore = () => {
  const propsPath = path.join(androidDir, 'keystore.properties')
  if (existsSync(propsPath)) {
    return
  }
  const keystoreDir = path.join(androidDir, 'keystore')
  const keystorePath = path.join(keystoreDir, 'demo-release.jks')
  const alias = 'demo'
  const password = randomBytes(18).toString('base64url')
  mkdirSync(keystoreDir, { recursive: true })
  if (!existsSync(keystorePath)) {
    const javaHome = process.env.JAVA_HOME ?? process.env.JDK_HOME ?? ''
    const keytool = javaHome
      ? path.join(javaHome, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool')
      : 'keytool'
    console.log('[build-apk] 未找到签名配置，生成本地演示证书 ...')
    run(
      keytool,
      [
        '-genkeypair',
        '-keystore',
        keystorePath,
        '-alias',
        alias,
        '-keyalg',
        'RSA',
        '-keysize',
        '2048',
        '-validity',
        '10950',
        '-storepass',
        password,
        '-keypass',
        password,
        '-dname',
        'CN=DeepsleepChat Demo, OU=Demo, O=Demo, L=Beijing, ST=Beijing, C=CN',
      ],
      root
    )
  }
  writeFileSync(
    propsPath,
    [
      '# 本地自动生成的演示签名配置（不提交 git）',
      '# 正式发布请替换 storeFile 指向真实证书并更新口令。',
      'storeFile=keystore/demo-release.jks',
      `storePassword=${password}`,
      `keyAlias=${alias}`,
      `keyPassword=${password}`,
      '',
    ].join('\n'),
    'utf8'
  )
}
if (!debug) {
  ensureSigningKeystore()
}

const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
const gradle = existsSync(path.join(androidDir, wrapper)) ? wrapper : 'gradle'

console.log(`[build-apk] 2/2 Gradle 打包 app:assemble${variant} ...`)
run(gradle, [`assemble${variant}`, '--console=plain'], androidDir)

const outputDir = path.join(androidDir, 'app', 'build', 'outputs', 'apk', debug ? 'debug' : 'release')
const apks = existsSync(outputDir) ? readdirSync(outputDir).filter((name) => name.endsWith('.apk')) : []
if (apks.length === 0) {
  console.error(`[build-apk] 未找到 APK，请检查 ${outputDir}`)
  process.exit(1)
}

const targetDir = path.join(root, 'build-output')
mkdirSync(targetDir, { recursive: true })
for (const name of apks) {
  const target = path.join(targetDir, name)
  copyFileSync(path.join(outputDir, name), target)
  console.log(`[build-apk] 完成：${target}`)
}
