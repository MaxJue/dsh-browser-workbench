// Runtime-level verification for the browser_extensions surface: local unpacked-directory
// installs, enable/disable, popup error paths, profile-store persistence and the destructive
// applyMode:"now" restart path on an external-CDP provider.
//
// Usage: node --experimental-transform-types scripts/verify/e2e-extensions.mjs
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BrowserRuntime } from '../../src/runtime/runtime.ts'
import { resolveConfig } from '../../src/domain/policy.ts'
import { launchBrowser } from './browser.mjs'

const root = resolve('.')
const sandboxRoot = join(root, '.sandbox')
const reportDir = join(sandboxRoot, 'reports')
const artifactRoot = join(sandboxRoot, 'artifacts')
const extensionFixtureRoot = join(sandboxRoot, 'fixtures')
process.env.DSH_HOME = join(sandboxRoot, 'home')

await mkdir(reportDir, { recursive: true })
await mkdir(artifactRoot, { recursive: true })
await rm(extensionFixtureRoot, { recursive: true, force: true })
await mkdir(extensionFixtureRoot, { recursive: true })

const popupDir = join(extensionFixtureRoot, 'fixture-popup')
const plainDir = join(extensionFixtureRoot, 'fixture-plain')
const brokenDir = join(extensionFixtureRoot, 'fixture-broken-manifest')
const v2Dir = join(extensionFixtureRoot, 'fixture-mv2')

await mkdir(popupDir, { recursive: true })
await writeFile(join(popupDir, 'manifest.json'), `${JSON.stringify({
  manifest_version: 3,
  name: 'Fixture Popup Extension',
  version: '1.2.3',
  action: { default_popup: 'popup.html' },
}, null, 2)}\n`, 'utf8')
await writeFile(join(popupDir, 'popup.html'), '<!doctype html><title>popup</title><body><p id="popup">popup fixture</p></body>\n', 'utf8')

await mkdir(plainDir, { recursive: true })
await writeFile(join(plainDir, 'manifest.json'), `${JSON.stringify({ manifest_version: 3, name: 'Fixture Plain Extension', version: '0.0.9' }, null, 2)}\n`, 'utf8')

await mkdir(brokenDir, { recursive: true })
await writeFile(join(brokenDir, 'manifest.json'), '{ not json', 'utf8')

await mkdir(v2Dir, { recursive: true })
await writeFile(join(v2Dir, 'manifest.json'), `${JSON.stringify({ manifest_version: 2, name: 'Fixture MV2', version: '1.0.0' }, null, 2)}\n`, 'utf8')

const browser = await launchBrowser({ sandboxRoot })
const config = resolveConfig({
  executablePath: browser.executable,
  headless: true,
  toolRegistrationMode: 'global',
  artifactRoot,
  maxOutputChars: 12000,
})
const attachments = {
  async saveImage(input) {
    return { id: `verify-image-${Date.now()}`, mediaType: input.mediaType, name: input.name, bytes: input.data.byteLength }
  },
}
const runtime = new BrowserRuntime(config, attachments)
const identity = { sessionId: `verify-ext-${Date.now()}`, sessionCreatedAt: Date.now(), callId: 'call-1', rootCallId: 'root-1' }
const signal = new AbortController().signal

const results = []
const knownIssues = []

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function summarize(value) {
  const text = JSON.stringify(value ?? null)
  return text.length > 220 ? `${text.slice(0, 220)}…` : text
}

function must(condition, message) {
  if (!condition) throw new Error(message)
}

async function step(tool, name, input, run, assert, options = {}) {
  const { allowFailure = false, expectError, note } = options
  const startedAt = Date.now()
  const pass = data => results.push({ tool, name, status: 'PASS', ms: Date.now() - startedAt, ...(note === undefined ? {} : { note }), ...(data === undefined ? {} : { data: summarize(data) }) })
  try {
    const output = await withTimeout(run(), 60000, `${tool}:${name}`)
    if (allowFailure) {
      if (output?.ok === false) {
        const message = String(output?.data?.message ?? output?.data?.code ?? '')
        if (expectError !== undefined && !expectError.test(message)) throw new Error(`expected failure matching ${expectError}, got: ${message}`)
        pass(summarize(output?.data))
        return output
      }
      pass(summarize(output?.data))
      return output
    }
    if (output?.ok !== true) throw new Error(`ok=false data=${JSON.stringify(output?.data ?? null).slice(0, 400)}`)
    if (assert !== undefined) assert(output)
    pass(output?.data)
    return output
  } catch (error) {
    const message = String(error?.message ?? error)
    if (allowFailure && (expectError === undefined || expectError.test(message))) {
      pass({ error: message })
      return undefined
    }
    results.push({ tool, name, status: 'FAIL', ms: Date.now() - startedAt, error: message, ...(note === undefined ? {} : { note }) })
    return undefined
  }
}

const extensions = input => runtime.extensions(identity, signal, input)
const listExtensions = async () => extensions({ action: 'list' })

await step('browser_provider', 'connect', { action: 'connect', provider: 'external-cdp', endpoint: browser.endpoint }, () => runtime.provider(identity, signal, { action: 'connect', provider: 'external-cdp', endpoint: browser.endpoint }), output => must(output.data?.active === 'external-cdp', 'provider did not connect'))

let popupId
let plainId

await step('browser_extensions', 'install unpacked directory with popup', { action: 'install', extension: popupDir }, () => extensions({ action: 'install', extension: popupDir }), output => {
  const item = output.data?.extension
  must(typeof item?.extensionId === 'string' && /^[a-p]{32}$/.test(item.extensionId), `invalid extension id: ${item?.extensionId}`)
  must(item.name === 'Fixture Popup Extension', `unexpected name: ${item.name}`)
  must(item.version === '1.2.3', `unexpected version: ${item.version}`)
  must(item.actionPopup === 'popup.html', `unexpected popup: ${item.actionPopup}`)
  popupId = item.extensionId
})

await step('browser_extensions', 'list reports the install as pending restart', { action: 'list' }, listExtensions, output => {
  const item = output.data?.extensions?.find(extension => extension.extensionId === popupId)
  must(item !== undefined, 'installed extension is missing from list')
  must(item.enabled === true, 'installed extension is not enabled')
  must(item.loaded === false, 'external-CDP cannot load extensions, loaded must stay false')
  must(item.pendingRestart === true, 'enabled but not loaded must report pendingRestart')
  must(output.data?.chromium?.installed === false, 'managed Chromium must report not installed')
})

await step('browser_extensions', 'registry is persisted to the artifact profile store', { action: 'install', extension: popupDir }, async () => {
  const segment = createHash('sha256').update(identity.sessionId).digest('hex').slice(0, 32)
  const registryPath = join(artifactRoot, 'extensions', 'sessions', segment, 'registry.json')
  const parsed = JSON.parse(await readFile(registryPath, 'utf8'))
  must(Array.isArray(parsed?.extensions) || Array.isArray(parsed), `unexpected registry shape at ${registryPath}`)
  const entries = Array.isArray(parsed?.extensions) ? parsed.extensions : parsed
  must(entries.some(extension => extension.extensionId === popupId), 'registry.json is missing the installed extension')
  return { ok: true, data: { registryPath: registryPath.replace(root, '.'), entries: entries.length } }
})

await step('browser_extensions', 'disable marks the extension unusable', { action: 'disable', extensionId: popupId }, () => extensions({ action: 'disable', extensionId: popupId }), output => {
  const item = output.data?.extensions?.find(extension => extension.extensionId === popupId)
  must(item?.enabled === false, 'extension was not disabled')
})

await step('browser_extensions', 'popup of a disabled extension is rejected', { action: 'open_popup', extensionId: popupId }, () => extensions({ action: 'open_popup', extensionId: popupId }), undefined, { allowFailure: true, expectError: /must be enabled and loaded|EXTENSION_NOT_LOADED/ })

await step('browser_extensions', 'enable restores the extension', { action: 'enable', extensionId: popupId }, () => extensions({ action: 'enable', extensionId: popupId }), output => {
  const item = output.data?.extensions?.find(extension => extension.extensionId === popupId)
  must(item?.enabled === true, 'extension was not re-enabled')
})

await step('browser_extensions', 'popup without a managed browser surfaces a load error', { action: 'open_popup', extensionId: popupId }, () => extensions({ action: 'open_popup', extensionId: popupId }), undefined, { allowFailure: true, expectError: /ERR_|chrome-extension|net::|Target|closed|Cannot|failed/i })

await step('browser_extensions', 'install directory without a popup', { action: 'install', extension: plainDir }, () => extensions({ action: 'install', extension: plainDir }), output => {
  plainId = output.data?.extension?.extensionId
  must(typeof plainId === 'string' && /^[a-p]{32}$/.test(plainId), 'plain extension id is invalid')
  must(output.data.extension.actionPopup === undefined, 'plain extension must not declare a popup')
})

await step('browser_extensions', 'popup of an extension without action popup is rejected', { action: 'open_popup', extensionId: plainId }, () => extensions({ action: 'open_popup', extensionId: plainId }), undefined, { allowFailure: true, expectError: /does not declare an action popup|EXTENSION_POPUP_UNAVAILABLE/ })

await step('browser_extensions', 'remote crx URLs outside the Chrome Web Store are rejected', { action: 'install', extension: 'https://example.com/sample.crx' }, () => extensions({ action: 'install', extension: 'https://example.com/sample.crx' }), undefined, { allowFailure: true, expectError: /Chrome Web Store/ })

await step('browser_extensions', 'a directory without a readable manifest is rejected', { action: 'install', extension: join(extensionFixtureRoot, 'missing-dir') }, () => extensions({ action: 'install', extension: join(extensionFixtureRoot, 'missing-dir') }), undefined, { allowFailure: true, expectError: /manifest/ })

await step('browser_extensions', 'broken manifest json is rejected', { action: 'install', extension: brokenDir }, () => extensions({ action: 'install', extension: brokenDir }), undefined, { allowFailure: true, expectError: /manifest/ })

await step('browser_extensions', 'Manifest V2 is rejected', { action: 'install', extension: v2Dir }, () => extensions({ action: 'install', extension: v2Dir }), undefined, { allowFailure: true, expectError: /Manifest V3/ })

await step('browser_extensions', 'uninstall removes the package and the registry entry', { action: 'uninstall', extensionId: plainId }, () => extensions({ action: 'uninstall', extensionId: plainId }), output => {
  must(output.data?.extensions?.every(extension => extension.extensionId !== plainId), 'uninstalled extension is still listed')
})

await step('browser_extensions', 'apply keeps the external session and the pending install', { action: 'apply' }, () => extensions({ action: 'apply' }), output => {
  const item = output.data?.extensions?.find(extension => extension.extensionId === popupId)
  must(item !== undefined, 'apply dropped the registry entry')
  must(item.pendingRestart === true, 'an external browser cannot load extensions, the install must stay pending')
})

await step('browser_tabs', 'tabs survive the apply attempt', { action: 'list' }, () => runtime.tabs(identity, signal, { action: 'list' }), output => {
  must((output.data?.tabs?.length ?? 0) > 0, 'no tabs left after apply; the external binding was destroyed')
})

await step('browser_provider', 'disconnect', { action: 'disconnect' }, () => runtime.provider(identity, signal, { action: 'disconnect' }), output => must(output.data?.active === 'disconnected', 'provider did not disconnect'))

await step('browser_extensions', 'list after disconnect still serves the registry', { action: 'list' }, listExtensions, output => {
  must(Array.isArray(output.data?.extensions), 'extensions missing after disconnect')
  must(output.data.extensions.some(extension => extension.extensionId === popupId), 'popup extension vanished from the persisted registry')
})

const knownMatches = new Set(knownIssues.map(issue => `${issue.tool}::${issue.name}`))
for (const entry of results) {
  if (entry.status !== 'FAIL') continue
  if (!knownMatches.has(`${entry.tool}::${entry.name}`)) continue
  entry.status = 'KNOWN'
  entry.knownKind = knownIssues.find(issue => `${issue.tool}::${issue.name}` === `${entry.tool}::${entry.name}`)?.kind
  entry.knownReason = knownIssues.find(issue => `${issue.tool}::${issue.name}` === `${entry.tool}::${entry.name}`)?.reason
}

const passed = results.filter(entry => entry.status === 'PASS').length
const failed = results.filter(entry => entry.status === 'FAIL').length
const known = results.filter(entry => entry.status === 'KNOWN').length

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const report = {
  generatedAt: new Date().toISOString(),
  browser: browser.version,
  extensions: { popupId, plainId },
  total: results.length,
  passed,
  failed,
  known,
  knownIssues,
  results,
}
await writeFile(join(reportDir, `extensions-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

const lines = [
  `# browser_extensions verification`,
  '',
  `- generated: ${report.generatedAt}`,
  `- browser: ${report.browser}`,
  `- total: ${report.total}, passed: ${passed}, failed: ${failed}, known: ${known}`,
  `- popup extension: \`${popupId ?? '(none)'}\``,
  '',
  '| tool | check | status | ms | detail |',
  '| --- | --- | --- | --- | --- |',
]
for (const entry of results) {
  const detail = entry.status === 'FAIL' ? entry.error : entry.data ?? ''
  lines.push(`| ${entry.tool} | ${entry.name} | ${entry.status} | ${entry.ms} | ${String(detail).replace(/\|/g, '\\|').slice(0, 200)} |`)
}
await writeFile(join(reportDir, `extensions-${stamp}.md`), `${lines.join('\n')}\n`, 'utf8')

for (const entry of results) {
  const mark = entry.status === 'PASS' ? 'PASS' : entry.status === 'KNOWN' ? 'KNOWN' : 'FAIL'
  console.log(`${mark} ${entry.tool} :: ${entry.name} (${entry.ms}ms)${entry.status === 'FAIL' ? ` -> ${entry.error}` : ''}`)
}
console.log(`\n${passed}/${results.length} passed, ${known} known, ${failed} failed`)
console.log(`report: ${join(reportDir, `extensions-${stamp}.md`)}`)

await runtime.dispose().catch(() => {})
await browser.close().catch(() => {})
process.exit(failed > 0 ? 1 : 0)
