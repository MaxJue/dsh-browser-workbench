// Managed-launch verification: the path that starts Chromium itself instead of attaching to a Chrome
// the user already runs. v2 exposes no tool that reaches it, so this harness calls the runtime's
// protected launch helpers directly and drives the real Chromium they start.
//
// Coverage: executablePath, headless/headed user agent, proxy modes (system/direct/custom),
// proxy authentication, HTTPS tunnelling through the proxy, shared persistent context, and the
// bundled Chromium downloader (metadata, offline install, integrity, host and timeout guards).
//
// Usage: node --experimental-transform-types scripts/verify/e2e-managed.mjs
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { resolveConfig } from '../../src/domain/policy.ts'
import { ChromiumManager } from '../../src/provider/chromium-manager.ts'
import { executablePath } from '../../src/provider/launch-config.ts'
import { BrowserRuntime } from '../../src/runtime/runtime.ts'
import { startFixtureServer, startSecureFixtureServer } from './fixtures.mjs'
import { startProxyServer } from './proxy-server.mjs'
import { makeZip } from './zip.mjs'

const root = resolve('.')
const sandboxRoot = join(root, '.sandbox')
const reportDir = join(sandboxRoot, 'reports')
const artifactRoot = join(sandboxRoot, 'artifacts-managed')
const certPath = join(sandboxRoot, 'certs', 'fixture.cer')
const pfxPath = join(sandboxRoot, 'certs', 'fixture.pfx')
const certThumbprint = '12BD0A4BE99CB590C901F0B3AAEE56501CF41DB2'
process.env.DSH_HOME = join(sandboxRoot, 'home')

await mkdir(reportDir, { recursive: true })
await mkdir(artifactRoot, { recursive: true })
await rm(join(sandboxRoot, 'chromium-offline'), { recursive: true, force: true })
await rm(join(sandboxRoot, 'chromium-tampered'), { recursive: true, force: true })
await rm(join(sandboxRoot, 'chromium-empty'), { recursive: true, force: true })

const baseOverrides = { headless: true, toolRegistrationMode: 'global', artifactRoot: artifactRoot, maxOutputChars: 12000 }
// resolveConfig normalises allowedOrigins into a Set, so every runtime must start from the raw plugin
// config rather than from an already-resolved one.
const baseConfig = resolveConfig(baseOverrides)
const systemChrome = executablePath(baseConfig)
if (systemChrome === undefined) throw new Error('no system Chrome or Edge was found for the managed-launch checks')
const expectedProduct = /msedge/i.test(systemChrome) ? 'Edg/' : 'Chrome/'
let probedVersion
try {
  probedVersion = /(\d+\.\d+\.\d+\.\d+)/.exec(execFileSync(systemChrome, ['--version'], { timeout: 15000 }).toString())?.[1]
} catch { probedVersion = undefined }

const attachments = { async saveImage() { return { id: `verify-image-${Date.now()}` } } }
const signal = new AbortController().signal
const results = []
let sequence = 0

function makeRuntime(overrides = {}) {
  sequence += 1
  const config = resolveConfig({ ...baseOverrides, ...overrides })
  return { runtime: new BrowserRuntime(config, attachments), identity: { sessionId: `verify-managed-${sequence}-${Date.now()}`, sessionCreatedAt: Date.now(), callId: `call-${sequence}`, rootCallId: `root-${sequence}` } }
}

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function summarize(value) {
  const json = JSON.stringify(value)
  if (json === undefined) return String(value)
  return json.length > 220 ? `${json.slice(0, 220)}…` : json
}

const certificates = { trusted: false, installed: false }
function certTrusted() {
  try {
    execFileSync('certutil', ['-user', '-store', 'Root', certThumbprint], { stdio: 'pipe' })
    return true
  } catch { return false }
}
function ensureCertTrusted() {
  certificates.trusted = certTrusted()
  if (certificates.trusted) return true
  try { execFileSync('certutil', ['-addstore', '-user', 'Root', certPath], { stdio: 'pipe' }) } catch { /* reported through certificates.trusted */ }
  certificates.trusted = certTrusted()
  certificates.installed = certificates.trusted
  return certificates.trusted
}
function removeCert() {
  if (!certificates.installed) return
  try { execFileSync('certutil', ['-delstore', '-user', 'Root', certThumbprint], { stdio: 'pipe' }) } catch { /* best effort */ }
}

async function step(name, run, assert, options = {}) {
  const startedAt = Date.now()
  if (options.skip !== undefined) {
    results.push({ name, status: 'SKIP', note: options.skip, ms: 0 })
    console.log(`SKIP ${name} :: ${options.skip}`)
    return undefined
  }
  const finish = (status, detail, note) => {
    results.push({ name, status, ms: Date.now() - startedAt, ...(note === undefined ? {} : { note }), ...(detail === undefined ? {} : { data: summarize(detail) }) })
    console.log(`${status} ${name}${detail === undefined ? '' : ` :: ${summarize(detail)}`}`)
  }
  try {
    const output = await withTimeout(run(), 120000, name)
    finish('PASS', assert(output))
    return output
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (options.allowFailure === true && (options.expectError === undefined || options.expectError.test(message))) {
      finish('PASS', { error: message }, options.note)
      return undefined
    }
    finish('FAIL', { error: message }, options.note)
    return undefined
  }
}

/** Opens one managed browser, runs the body, always closes both browser and runtime. */
async function withManaged(overrides, body) {
  const { runtime, identity } = makeRuntime(overrides)
  let context
  try {
    const launched = await runtime.persistentContext(`verify-managed-${sequence}`, 'default')
    context = launched.context
    return await body(context, runtime, identity)
  } finally {
    await context?.close().catch(() => {})
    await runtime.dispose().catch(() => {})
  }
}

let fixture
let secureFixture
const proxies = []
const certReady = ensureCertTrusted()
try {
  fixture = await startFixtureServer()
  secureFixture = await startSecureFixtureServer({ pfxPath })

  await step('provider surface offers only external-cdp', async () => {
    const { runtime, identity } = makeRuntime()
    try {
      const output = await runtime.provider(identity, signal, { action: 'list' })
      return output.data
    } finally { await runtime.dispose() }
  }, data => {
    const providers = data.providers.map(item => item.provider)
    if (JSON.stringify(providers) !== JSON.stringify(['disconnected', 'external-cdp'])) throw new Error(`unexpected providers: ${JSON.stringify(providers)}`)
    return { active: data.active, providers }
  })

  await step('managed launch honours executablePath', () => withManaged({}, async context => {
    const page = await context.newPage()
    await page.goto(fixture.base, { waitUntil: 'domcontentloaded' })
    const title = await page.title()
    const userAgent = await page.evaluate(() => navigator.userAgent)
    const version = context.browser()?.version()
    return { title, version, userAgent, headlessMarker: userAgent.includes('HeadlessChrome'), probedVersion }
  }), data => {
    if (probedVersion !== undefined && data.version !== probedVersion) throw new Error(`browser version ${data.version} did not come from ${systemChrome} (${probedVersion})`)
    if (!data.userAgent.includes(expectedProduct)) throw new Error(`user agent ${data.userAgent} did not identify ${expectedProduct}`)
    if (data.title !== 'Fixture Home') throw new Error(`unexpected title ${data.title}`)
    if (!data.headlessMarker) throw new Error('headless launch did not report the headless user agent')
    return { version: data.version, title: data.title }
  })

  await step('managed launch rejects a missing executable', () => withManaged({ executablePath: join(sandboxRoot, 'missing', 'chrome.exe') }, async () => 'launched'), () => 'unreachable', {
    allowFailure: true,
    expectError: /ENOENT|no such file|does not exist|spawn|Failed to launch/i,
  })

  await step('headed launch clears the headless marker', () => withManaged({ headless: false }, async context => {
    const page = await context.newPage()
    await page.goto(fixture.base, { waitUntil: 'domcontentloaded' })
    const userAgent = await page.evaluate(() => navigator.userAgent)
    return { headlessMarker: userAgent.includes('HeadlessChrome'), title: await page.title() }
  }), data => {
    if (data.headlessMarker) throw new Error('headed launch still reported the headless user agent')
    if (data.title !== 'Fixture Home') throw new Error(`unexpected title ${data.title}`)
    return { headlessMarker: data.headlessMarker }
  })

  await step('custom proxy carries plain HTTP traffic', async () => {
    const proxy = await startProxyServer()
    proxies.push(proxy)
    return withManaged({ proxy: { mode: 'custom', server: proxy.url } }, async context => {
      const page = await context.newPage()
      await page.goto(fixture.base, { waitUntil: 'domcontentloaded' })
      return { title: await page.title(), entries: proxy.entries.slice(), base: fixture.base }
    })
  }, data => {
    if (data.title !== 'Fixture Home') throw new Error(`unexpected title ${data.title}`)
    const matches = data.entries.filter(entry => entry.kind === 'request' && entry.target.startsWith(data.base))
    if (matches.length === 0) throw new Error(`proxy saw no request for ${data.base}: ${JSON.stringify(data.entries)}`)
    return { proxied: matches.length, target: matches[0].target }
  })

  await step('custom proxy tunnels HTTPS through CONNECT', async () => {
    const proxy = await startProxyServer()
    proxies.push(proxy)
    return withManaged({ proxy: { mode: 'custom', server: proxy.url } }, async context => {
      const page = await context.newPage()
      await page.goto(secureFixture.base, { waitUntil: 'domcontentloaded' })
      return { title: await page.title(), entries: proxy.entries.slice(), port: new URL(secureFixture.base).port }
    })
  }, data => {
    if (data.title !== 'Fixture Home') throw new Error(`unexpected title ${data.title}`)
    const tunnels = data.entries.filter(entry => entry.kind === 'connect' && entry.target === `127.0.0.1:${data.port}`)
    if (tunnels.length === 0) throw new Error(`proxy saw no CONNECT for 127.0.0.1:${data.port}: ${JSON.stringify(data.entries)}`)
    return { tunnels: tunnels.length, title: data.title }
  }, certReady ? {} : { skip: `the self-signed fixture certificate could not be trusted by certutil (${certThumbprint})` })

  await step('proxy credentials are forwarded to an authenticating proxy', async () => {
    const proxy = await startProxyServer({ username: 'verify', password: 'secret' })
    proxies.push(proxy)
    const fixtureHost = new URL(fixture.base).host
    return withManaged({ proxy: { mode: 'custom', server: proxy.url, username: 'verify', password: 'secret' } }, async context => {
      const page = await context.newPage()
      await page.goto(fixture.base, { waitUntil: 'domcontentloaded' })
      return { title: await page.title(), entries: proxy.entries.slice(), fixtureHost }
    })
  }, data => {
    if (data.title !== 'Fixture Home') throw new Error(`unexpected title ${data.title}`)
    const fixtureEntries = data.entries.filter(entry => entry.target.includes(data.fixtureHost))
    if (fixtureEntries.length === 0) throw new Error(`the proxy saw no fixture traffic: ${JSON.stringify(data.entries)}`)
    // Chrome answers the first 407 challenge and then replays the request with Proxy-Authorization,
    // so the log legitimately contains the challenged attempt before the authenticated one.
    if (!fixtureEntries.some(entry => entry.authorized)) throw new Error(`no authenticated fixture traffic: ${JSON.stringify(fixtureEntries)}`)
    return { fixtureEntries: fixtureEntries.length, authorized: fixtureEntries.filter(entry => entry.authorized).length, background: data.entries.length - fixtureEntries.length }
  })

  await step('missing proxy credentials are rejected', async () => {
    const proxy = await startProxyServer({ username: 'verify', password: 'secret' })
    proxies.push(proxy)
    return withManaged({ proxy: { mode: 'custom', server: proxy.url } }, async context => {
      const page = await context.newPage()
      let error
      try {
        await page.goto(fixture.base, { waitUntil: 'domcontentloaded', timeout: 15000 })
      } catch (caught) { error = caught instanceof Error ? caught.message : String(caught) }
      return { title: await page.title().catch(() => ''), entries: proxy.entries.slice(), error }
    })
  }, data => {
    const unauthorized = data.entries.filter(entry => !entry.authorized)
    if (unauthorized.length === 0) throw new Error(`the proxy never saw an unauthenticated request: ${JSON.stringify(data.entries)}`)
    if (data.error === undefined && data.title === 'Fixture Home') throw new Error('the page loaded even though the proxy demanded credentials')
    return { unauthorized: unauthorized.length, error: data.error ?? 'page failed to load' }
  })

  await step('direct mode never touches the proxy', async () => {
    const proxy = await startProxyServer()
    proxies.push(proxy)
    return withManaged({ proxy: { mode: 'direct' } }, async context => {
      const page = await context.newPage()
      await page.goto(fixture.base, { waitUntil: 'domcontentloaded' })
      return { title: await page.title(), entries: proxy.entries.slice() }
    })
  }, data => {
    if (data.title !== 'Fixture Home') throw new Error(`unexpected title ${data.title}`)
    if (data.entries.length !== 0) throw new Error(`direct mode still used the proxy: ${JSON.stringify(data.entries)}`)
    return { proxyEntries: 0 }
  })

  await step('system mode launches without an explicit proxy', () => withManaged({ proxy: { mode: 'system' } }, async context => {
    const page = await context.newPage()
    await page.goto(fixture.base, { waitUntil: 'domcontentloaded' })
    return { title: await page.title() }
  }), data => {
    if (data.title !== 'Fixture Home') throw new Error(`unexpected title ${data.title}`)
    return { title: data.title }
  })

  await step('shared persistent context is reused and evicts foreign pages', async () => {
    const { runtime } = makeRuntime()
    let first
    let second
    try {
      first = await runtime.launchSharedPersistentContext()
      second = await runtime.sharedPersistentContext()
      const page = await second.newPage()
      let closed = false
      for (let attempt = 0; attempt < 25 && !closed; attempt += 1) {
        if (page.isClosed()) { closed = true; break }
        await new Promise(done => setTimeout(done, 200))
      }
      return { same: first === second, closed, pages: second.pages().length }
    } finally {
      await first?.close().catch(() => {})
      await runtime.dispose().catch(() => {})
    }
  }, data => {
    if (!data.same) throw new Error('sharedPersistentContext launched a second browser')
    // Pages opened by anything but the plugin's own session routing are closed on purpose: the shared
    // profile belongs to DSH, not to whoever happens to call context.newPage().
    if (!data.closed) throw new Error('a foreign page survived in the shared persistent context')
    return { same: data.same, foreignPageEvicted: data.closed, pages: data.pages }
  })
} finally {
  for (const proxy of proxies) await proxy.close().catch(() => {})
  await secureFixture?.close().catch(() => {})
  await fixture?.close().catch(() => {})
  removeCert()
}

// ---- bundled Chromium downloader -----------------------------------------------------------------

const staleRoot = join(sandboxRoot, 'chromium-empty')
await step('bundled download metadata is missing for the pinned playwright', async () => {
  const manager = new ChromiumManager(staleRoot, { source: 'auto', timeoutMs: 2000 })
  const status = await manager.status()
  try {
    await manager.ensureInstalled()
    return { status, error: undefined }
  } catch (error) {
    return { status, error: error instanceof Error ? error.message : String(error) }
  } finally { await manager.dispose() }
}, data => {
  if (data.error === undefined) throw new Error('ensureInstalled succeeded although playwright-core pins an archive without verified metadata')
  if (!/does not have verified archive metadata/.test(data.error)) throw new Error(`unexpected error: ${data.error}`)
  if (data.status.installed) throw new Error('status reported an installed browser')
  return { error: data.error }
})

function archiveServer(archive, hits) {
  const server = createServer((request, response) => {
    hits.count += 1
    response.writeHead(200, { 'content-type': 'application/zip', 'content-length': archive.length })
    response.end(archive)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

const archiveBytes = makeZip([{ name: 'chrome-win64/chrome.exe', data: 'verify-chrome-binary' }])
const archiveMd5 = createHash('md5').update(archiveBytes).digest('hex')
const hits = { count: 0 }
const served = await archiveServer(archiveBytes, hits)
const offlineDescriptorValue = () => ({
  revision: '9999',
  browserVersion: '0.0.0-verify',
  platform: 'win64',
  archiveName: 'chrome-win64.zip',
  executableRelativePath: join('chrome-win64', 'chrome.exe'),
  directoryName: 'chromium-9999',
  archiveBytes: archiveBytes.length,
  archiveMd5,
})
const offlineDescriptor = async () => offlineDescriptorValue()
const offlineAttempts = () => [{ source: 'npmmirror', url: `http://127.0.0.1:${served.port}/chrome-win64.zip`, allowedHosts: ['127.0.0.1'] }]
const offlineRoot = join(sandboxRoot, 'chromium-offline')

try {
  await step('offline install verifies size, digest and extracts', async () => {
    const manager = new ChromiumManager(offlineRoot, { source: 'npmmirror', timeoutMs: 10000, descriptor: offlineDescriptor, attempts: offlineAttempts })
    try {
      const executable = await manager.ensureInstalled()
      const content = (await readFile(executable, 'utf8')).trim()
      const status = await manager.status()
      const again = await manager.ensureInstalled()
      return { executable, content, status, reused: again === executable, hits: hits.count }
    } finally { await manager.dispose() }
  }, data => {
    if (data.content !== 'verify-chrome-binary') throw new Error(`extracted executable content was ${data.content}`)
    if (!data.status.installed || data.status.executablePath === undefined) throw new Error('status did not report the installed browser')
    if (!data.reused) throw new Error('a second ensureInstalled call reinstalled the browser')
    if (data.hits !== 1) throw new Error(`the archive was downloaded ${data.hits} times`)
    return { executable: data.executable, status: data.status }
  })

  await step('install refuses a tampered digest', async () => {
    const manager = new ChromiumManager(join(sandboxRoot, 'chromium-tampered'), {
      source: 'npmmirror',
      timeoutMs: 10000,
      descriptor: async () => ({ ...offlineDescriptorValue(), archiveMd5: 'deadbeefdeadbeefdeadbeefdeadbeef' }),
      attempts: offlineAttempts,
    })
    try {
      await manager.ensureInstalled()
      return { error: undefined }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    } finally { await manager.dispose() }
  }, data => {
    if (data.error === undefined) throw new Error('a tampered archive was installed')
    if (!/failed integrity verification/.test(data.error)) throw new Error(`unexpected error: ${data.error}`)
    return { error: data.error }
  })

  await step('install rejects a non-HTTPS attempt host', async () => {
    const manager = new ChromiumManager(join(sandboxRoot, 'chromium-empty'), {
      source: 'npmmirror',
      timeoutMs: 5000,
      descriptor: offlineDescriptor,
      attempts: () => [{ source: 'npmmirror', url: `http://localhost:${served.port}/chrome-win64.zip`, allowedHosts: ['localhost'] }],
    })
    try {
      await manager.ensureInstalled()
      return { error: undefined }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    } finally { await manager.dispose() }
  }, data => {
    if (data.error === undefined) throw new Error('a plain-HTTP download from a non-loopback host was allowed')
    if (!/requires HTTPS/.test(data.error)) throw new Error(`unexpected error: ${data.error}`)
    return { error: data.error }
  })

  await step('install times out a stalled download', async () => {
    const stalled = createServer(() => { /* never responds */ })
    const port = await new Promise(resolve => stalled.listen(0, '127.0.0.1', () => resolve(stalled.address().port)))
    const manager = new ChromiumManager(join(sandboxRoot, 'chromium-empty'), {
      source: 'npmmirror',
      timeoutMs: 600,
      descriptor: offlineDescriptor,
      attempts: () => [{ source: 'npmmirror', url: `http://127.0.0.1:${port}/chrome-win64.zip`, allowedHosts: ['127.0.0.1'] }],
    })
    try {
      await manager.ensureInstalled()
      return { error: undefined }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    } finally {
      await manager.dispose()
      stalled.closeAllConnections()
      await new Promise(done => stalled.close(() => done()))
    }
  }, data => {
    if (data.error === undefined) throw new Error('a stalled download did not fail')
    if (!/download timed out after 600ms/.test(data.error)) throw new Error(`unexpected error: ${data.error}`)
    return { error: data.error }
  })
} finally {
  served.server.closeAllConnections()
  await new Promise(done => served.server.close(() => done()))
}

// ---- report --------------------------------------------------------------------------------------

const passed = results.filter(item => item.status === 'PASS').length
const failed = results.filter(item => item.status === 'FAIL').length
const skipped = results.filter(item => item.status === 'SKIP').length
const stamp = new Date().toISOString().replaceAll(':', '-')
const report = { stamp, executable: systemChrome, executableVersion: probedVersion ?? systemChrome, total: results.length, passed, failed, skipped, certificates, results }
await writeFile(join(reportDir, `managed-${stamp}.json`), JSON.stringify(report, undefined, 2))
const table = results.map(item => `| ${item.status} | ${item.name} | ${item.ms} | ${(item.data ?? item.note ?? '').toString().replaceAll('|', '\\|').slice(0, 120)} |`).join('\n')
await writeFile(join(reportDir, `managed-${stamp}.md`), [
  '# Managed launch verification',
  '',
  `- executable: ${systemChrome} (${probedVersion ?? 'version not reported'})`,
  `- certificate trusted: ${certificates.trusted}`,
  `- total ${results.length}, passed ${passed}, failed ${failed}, skipped ${skipped}`,
  '',
  '| status | check | ms | detail |',
  '| --- | --- | --- | --- |',
  table,
  '',
].join('\n'))
console.log(`\n${passed}/${results.length} managed checks passed${skipped === 0 ? '' : ` (${skipped} skipped)`}, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
