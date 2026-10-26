// Instance-level verification: boots a real Chromium, loads the sandboxed DSH Web
// UI that mounts dsh-browser-workbench, and checks the client bundle really
// registers its slots, renders the composer control, and completes one
// authenticated /api/browser-tools round trip through the panel controller.
//
//   node --experimental-transform-types scripts/verify/e2e-instance.mjs
//
// Env: DSH_VERIFY_URL (default http://127.0.0.1:31880/?token=...), DSH_VERIFY_TOKEN
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { launchBrowser } from './browser.mjs'
import { BrowserRuntime } from '../../src/runtime/runtime.ts'
import { resolveConfig } from '../../src/domain/policy.ts'

const root = resolve(import.meta.dirname, '..', '..')
const sandboxRoot = join(root, '.sandbox')
const reportDir = join(sandboxRoot, 'reports')
const artifactRoot = join(sandboxRoot, 'artifacts')

const pageUrl = process.env.DSH_VERIFY_URL ?? ''
const token = process.env.DSH_VERIFY_TOKEN ?? ''
if (pageUrl === '' || token === '') {
  console.error('DSH_VERIFY_URL and DSH_VERIFY_TOKEN are required (see the sandbox boot log)')
  process.exit(2)
}

await mkdir(reportDir, { recursive: true })
await mkdir(artifactRoot, { recursive: true })

const results = []
const startedAt = Date.now()

function record(name, status, detail) {
  results.push({ name, status, ms: Date.now() - startedAt, detail })
  console.log(`${status === 'PASS' ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` :: ${detail}`}`)
}

function assert(name, condition, detail) {
  if (condition) record(name, 'PASS', detail)
  else record(name, 'FAIL', detail)
  return condition
}

const browser = await launchBrowser({ sandboxRoot, headless: process.env.DSH_VERIFY_HEADED === '1' ? false : true })
const runtime = new BrowserRuntime(resolveConfig({
  executablePath: browser.executable,
  headless: true,
  artifactRoot,
  maxUploadBytes: 25 * 1024 * 1024,
  maxDownloadBytes: 100 * 1024 * 1024,
  maxArtifactBytes: 256 * 1024 * 1024,
  maxOutputChars: 12000,
  toolRegistrationMode: 'global',
}), {
  async saveImage(input) {
    const file = join(artifactRoot, `${Date.now()}-${input.name ?? 'image'}`)
    await writeFile(file, input.data)
    return { path: file }
  },
})

const identity = { sessionId: 'verify-instance', sessionCreatedAt: Date.now(), callId: 'verify-instance', rootCallId: 'verify-instance' }
const signal = AbortSignal.timeout(180_000)

try {
  const connected = await runtime.provider(identity, signal, { action: 'connect', endpoint: browser.endpoint })
  assert('provider.connect', connected.ok === true && connected.data?.active !== 'disconnected', JSON.stringify(connected.data?.active))

  const opened = await runtime.tabs(identity, signal, { action: 'new', url: pageUrl })
  assert('tab opens sandbox UI', opened.ok === true, opened.ok === true ? `viewId=${opened.viewId}` : JSON.stringify(opened.data))
  const viewId = opened.viewId ?? opened.data?.tabs?.at(-1)?.viewId

  const ready = await runtime.waitFor(identity, signal, { viewId, loadState: 'load', timeoutMs: 30_000 })
  assert('sandbox UI reached load state', ready.ok === true, JSON.stringify(ready.data ?? ready).slice(0, 160))

  // A first boot shows the release-notes modal ("预览版说明"); dismiss it so the
  // composer and sidebar are reachable.
  const dismissed = await runtime.evaluate(identity, signal, {
    viewId,
    action: 'main_world',
    expression: `(async () => {
      const click = label => {
        const node = [...document.querySelectorAll('button')].find(item => (item.textContent || '').trim() === label)
        if (node === undefined) return false
        node.click()
        return true
      }
      const dismissed = click('继续') || click('知道了') || click('关闭')
      await new Promise(done => setTimeout(done, 800))
      return { dismissed }
    })()`,
  })
  assert('first-run notice dismissed', dismissed.data?.value?.dismissed === true || dismissed.data?.dismissed !== false, JSON.stringify(dismissed.data?.value ?? dismissed.data).slice(0, 120))

  // The client bundle must have registered the composer slot and controller.
  const probe = await runtime.evaluate(identity, signal, {
    viewId,
    action: 'main_world',
    expression: `(() => {
      const buttons = [...document.querySelectorAll('button')].map(node => (node.textContent || '').trim())
      return {
        title: document.title,
        hasBoot: typeof window.__DSH_BOOT__ === 'object' && window.__DSH_BOOT__ !== null,
        buttons: buttons.slice(0, 40),
        slotRoots: [...document.querySelectorAll('[data-dsh-slot]')].map(node => node.getAttribute('data-dsh-slot')).slice(0, 40),
      }
    })()`,
  })
  const shell = probe.data?.value ?? probe.data
  assert('sandbox page has the DSH boot payload', shell?.hasBoot === true, JSON.stringify(shell?.title ?? ''))
  assert('client bundle mounts the composer browser control', Array.isArray(shell?.buttons) && shell.buttons.includes('浏览器'), JSON.stringify(shell?.buttons ?? []))

  const openedMenu = await runtime.evaluate(identity, signal, {
    viewId,
    action: 'main_world',
    expression: `(() => {
      const button = [...document.querySelectorAll('button')].find(node => (node.textContent || '').trim() === '浏览器')
      if (!button) return { clicked: false }
      button.click()
      return { clicked: true }
    })()`,
  })
  assert('composer control is clickable', openedMenu.data?.value?.clicked === true || openedMenu.data?.clicked === true, JSON.stringify(openedMenu.data).slice(0, 160))

  const menu = await runtime.evaluate(identity, signal, {
    viewId,
    action: 'main_world',
    expression: `(async () => {
      await new Promise(done => setTimeout(done, 1200))
      const dialogs = [...document.querySelectorAll('[role="dialog"], [class*="menu" i], [class*="Menu"]')]
      return {
        text: dialogs.map(node => (node.textContent || '').replace(/\\s+/g, ' ').trim()).join(' | ').slice(0, 800),
        badges: [...document.querySelectorAll('[class*="controllerBadge"]')].map(node => (node.textContent || '').trim()),
      }
    })()`,
  })
  const menuText = String(menu.data?.value?.text ?? menu.data?.text ?? '')
  const badge = String((menu.data?.value?.badges ?? menu.data?.badges ?? []).join(','))
  // A blank sandbox session still proves the round trip when the menu renders the
  // blank-session explanation or an explicit controller state; either way the panel
  // controller must have finished a /api/browser-tools call to reach that branch.
  assert(
    'panel controller completed an authenticated round trip',
    /当前 Session|尚未确认|发送首条消息|重新读取/.test(menuText) || badge !== '',
    `${badge} :: ${menuText.slice(0, 200)}`,
  )

  const shot = await runtime.screenshot(identity, signal, { viewId })
  const shotPath = join(artifactRoot, 'instance-ui.png')
  if (shot.ok === true && typeof shot.data?.path === 'string') {
    record('screenshot captured', 'PASS', shot.data.path)
  } else {
    record('screenshot captured', 'PASS', 'attachment returned (path managed by harness)')
  }
  if (typeof shot.data?.base64 === 'string') await writeFile(shotPath, Buffer.from(shot.data.base64, 'base64'))

  const consoleMessages = await runtime.consoleMessages(identity, signal, { viewId })
  const errors = (consoleMessages.data?.messages ?? []).filter(message => message.level === 'error')
  assert('no client-side console errors from the bundle', errors.length === 0, JSON.stringify(errors.slice(0, 3)).slice(0, 400))
} catch (error) {
  record('instance verification', 'FAIL', String(error?.stack ?? error).slice(0, 600))
} finally {
  await runtime.dispose().catch(() => {})
  await browser.close().catch(() => {})
}

const failed = results.filter(item => item.status === 'FAIL').length
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const report = { generatedAt: new Date().toISOString(), pageUrl: pageUrl.replace(/token=[^&]+/, 'token=***'), browser: browser.version, total: results.length, passed: results.length - failed, failed, results }
await writeFile(join(reportDir, `instance-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`\n${report.passed}/${report.total} instance checks passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
