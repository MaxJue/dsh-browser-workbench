// RPC + persistence verification against the sandboxed DSH instance.
//
// Part A checks the /api/browser-tools boundary over plain HTTP: token exchange,
// the httpOnly auth cookie, rejection of anonymous calls, and the Connection RPC
// envelope contract.
// Part B checks that a controller selection made through the real UI survives a
// page reload, i.e. it is persisted server-side instead of living in client state.
//
//   node --experimental-transform-types scripts/verify/e2e-rpc.mjs
//
// Env: DSH_VERIFY_URL, DSH_VERIFY_TOKEN
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
const origin = new URL(pageUrl).origin
const apiUrl = `${origin}/api/browser-tools`

await mkdir(reportDir, { recursive: true })
await mkdir(artifactRoot, { recursive: true })

const results = []
const startedAt = Date.now()
const record = (name, status, detail) => {
  results.push({ name, status, ms: Date.now() - startedAt, detail })
  console.log(`${status} ${name}${detail === undefined ? '' : ` :: ${detail}`}`)
}
const check = (name, ok, detail) => record(name, ok ? 'PASS' : 'FAIL', detail)
const sleep = ms => new Promise(done => setTimeout(done, ms))

// ---------------------------------------------------------------------------
// Part A: HTTP boundary
// ---------------------------------------------------------------------------
async function post(body, cookie) {
  const headers = { 'content-type': 'application/json' }
  if (cookie !== undefined) headers.cookie = cookie
  const response = await fetch(apiUrl, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
  return { status: response.status, text: (await response.text()).slice(0, 200) }
}

{
  const anonymous = await fetch(`${origin}/`, { redirect: 'manual' })
  check('the UI is not readable without a token', anonymous.status === 401, String(anonymous.status))

  const wrongToken = await fetch(`${origin}/?token=not-a-real-token`, { redirect: 'manual' })
  check('a wrong token is rejected', wrongToken.status === 401, String(wrongToken.status))

  const landing = await fetch(pageUrl, { redirect: 'manual' })
  const setCookie = landing.headers.getSetCookie?.() ?? []
  const cookieHeader = setCookie.map(value => value.split(';')[0]).join('; ')
  check('a valid token issues the auth cookie', landing.status === 303 && /dsh-auth-/.test(cookieHeader), `${landing.status} · ${cookieHeader.split('=')[0] || 'no cookie'}`)

  const anonymousCall = await post({ endpoint: 'controller_status', payload: {} })
  check('anonymous RPC calls are refused', anonymousCall.status === 401, `${anonymousCall.status} ${anonymousCall.text}`)

  const garbage = await post('not json at all', cookieHeader)
  check('malformed bodies are refused before dispatch', garbage.status === 400 && /body is not JSON/.test(garbage.text), `${garbage.status} ${garbage.text}`)

  const envelope = await post({ endpoint: 'controller_status', payload: {} }, cookieHeader)
  check('the RPC route only accepts Connection envelopes', envelope.status === 400 && /invalid Connection RPC envelope/.test(envelope.text), `${envelope.status} ${envelope.text}`)

  const tampered = cookieHeader.replace(/=.*/, '=v1.tampered.signature')
  const tamperedCall = await post({ endpoint: 'controller_status', payload: {} }, tampered)
  check('a tampered cookie is refused', tamperedCall.status === 401, `${tamperedCall.status} ${tamperedCall.text}`)

  const unknown = await fetch(`${origin}/api/not-a-route`, { headers: { cookie: cookieHeader } })
  check('unknown API routes 404 instead of leaking the RPC handler', unknown.status === 404, String(unknown.status))

  const authenticatedUi = await fetch(`${origin}/`, { headers: { cookie: cookieHeader }, redirect: 'manual' })
  const html = authenticatedUi.status === 200 ? await authenticatedUi.text() : ''
  check('the auth cookie alone grants the UI', authenticatedUi.status === 200 && html.includes('__DSH_BOOT__'), `${authenticatedUi.status} · ${html.length} bytes`)
  check('the auth cookie is httpOnly', setCookie.some(value => /HttpOnly/i.test(value)), String(setCookie.length > 0))
}

// ---------------------------------------------------------------------------
// Part B: controller selection persistence
// ---------------------------------------------------------------------------
const menuExpr = "[...document.querySelectorAll('[class*=\"menu\"]')].filter(node => !/menuAnchor/.test(String(node.className))).at(-1) ?? null"

const browser = await launchBrowser({ sandboxRoot, headless: true })
const runtime = new BrowserRuntime(resolveConfig({
  executablePath: browser.executable,
  headless: true,
  artifactRoot,
  maxOutputChars: 12000,
  toolRegistrationMode: 'global',
}), {
  async saveImage(input) {
    const file = join(artifactRoot, `${Date.now()}-${input.name ?? 'image'}`)
    if (input.data !== undefined) await writeFile(file, input.data)
    return { path: file }
  },
})

const identity = { sessionId: 'verify-rpc', sessionCreatedAt: Date.now(), callId: 'verify-rpc', rootCallId: 'verify-rpc' }
const signal = AbortSignal.timeout(600_000)
let viewId

const ev = async (expression) => {
  const out = await runtime.evaluate(identity, signal, { viewId, action: 'main_world', expression })
  if (out.ok === false) throw new Error(`evaluate failed: ${JSON.stringify(out.data).slice(0, 300)}`)
  return out.data?.value ?? out.data
}
const waitUntil = async (expression, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await ev(expression).catch(() => false)) return true
    await sleep(400)
  }
  throw new Error(`timed out waiting for ${label}`)
}
const dismissModal = async () => ev(`(async () => {
  const click = label => {
    const node = [...document.querySelectorAll('button')].find(item => (item.textContent || '').trim() === label)
    if (!node) return false
    node.click()
    return true
  }
  click('继续') || click('知道了') || click('关闭')
  await new Promise(done => setTimeout(done, 700))
  return true
})()`)
const badgeText = async () => ev(`(() => {
  const node = document.querySelector('[class*="controllerBadge"]')
  return node === null ? '' : (node.textContent || '').replace(/\\s+/g, ' ').trim()
})()`)
const menuInfo = async () => ev(`(() => {
  const menu = ${menuExpr}
  if (menu === null) return { text: '', visible: false, buttons: [] }
  const visible = menu.offsetParent !== null && menu.getClientRects().length > 0
  return {
    text: (menu.textContent || '').replace(/\\s+/g, ' ').trim(),
    visible,
    buttons: [...menu.querySelectorAll('button')].map(node => (node.textContent || '').trim()),
  }
})()`)
const openMenu = async () => {
  const current = await menuInfo()
  if (current.visible === true) return current
  await ev(`(() => {
    const button = document.querySelector('[class*="controlButton"]')
    if (!button) return false
    button.click()
    return true
  })()`)
  await sleep(700)
  return menuInfo()
}
const clickMenuButton = async (label) => {
  const out = await ev(`(() => {
    const wanted = ${JSON.stringify(label)}
    const candidates = [...document.querySelectorAll('button')].filter(node => {
      if ((node.textContent || '').trim() !== wanted) return false
      if (node.disabled) return false
      return node.offsetParent !== null && node.getClientRects().length > 0
    })
    const inControllerMenu = candidates.filter(node => {
      const host = node.closest('[class*="menu"]')
      return host !== null && !/menuAnchor/.test(String(host.className))
    })
    const node = inControllerMenu.at(-1) ?? candidates.at(-1)
    if (node === undefined) return { clicked: false }
    node.click()
    return { clicked: true }
  })()`)
  await sleep(900)
  return out
}

try {
  const connected = await runtime.provider(identity, signal, { action: 'connect', endpoint: browser.endpoint })
  check('probe runtime connected to Chrome', connected.ok === true, JSON.stringify(connected.data?.active ?? connected.data).slice(0, 120))

  const opened = await runtime.tabs(identity, signal, { action: 'new', url: pageUrl })
  viewId = opened.viewId ?? opened.data?.viewId
  await runtime.waitFor(identity, signal, { viewId, loadState: 'load', timeoutMs: 30_000 }).catch(() => undefined)
  await runtime.emulate(identity, signal, { viewId, action: 'viewport', width: 1600, height: 1000, deviceScaleFactor: 1 }).catch(() => undefined)
  await sleep(1200)
  await dismissModal()

  const composerRef = (await runtime.query(identity, signal, { viewId, selector: '[data-composer-input="true"]', field: 'refs' })).data?.refs?.[0]?.ref
  await runtime.elementAction(identity, signal, { viewId, action: 'type', ref: composerRef, text: '只回复 OK', submit: false })
  const sendRef = (await runtime.query(identity, signal, { viewId, selector: 'button[aria-label="发送消息"]', field: 'refs' })).data?.refs?.[0]?.ref
  await runtime.elementAction(identity, signal, { viewId, action: 'click', ref: sendRef })
  await waitUntil(`(() => { const node = document.querySelector('[data-composer-input="true"]'); return node !== null && (node.innerText || '').trim() === '' })()`, 20_000, 'composer to clear').catch(() => undefined)

  let formal = false
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const info = await openMenu()
    if (info.buttons?.includes('使用 DSH BrowserWorkbench')) {
      const enabled = await ev(`(() => {
        const wanted = '使用 DSH BrowserWorkbench'
        const node = [...document.querySelectorAll('button')].find(item => (item.textContent || '').trim() === wanted)
        return node !== undefined && node.disabled === false
      })()`)
      if (enabled === true) { formal = true; break }
    }
    await sleep(1200)
  }
  check('the sandbox session is formal enough to claim a controller', formal === true)

  await clickMenuButton('使用 DSH BrowserWorkbench')
  await clickMenuButton('确认选择')
  const locked = await waitUntil(`(() => { const node = document.querySelector('[class*="controllerBadge"]'); return node !== null && /已锁定|DSH BrowserWorkbench/.test(node.textContent || '') })()`, 20_000, 'controller badge to lock').catch(() => false)
  check('the controller badge reports the claim', locked === true, String(await badgeText()).slice(0, 120))

  // Persistence: reload the page. A client-only selection would fall back to
  // "尚未选择浏览器工具"; a server-persisted one still reads as claimed.
  const reloaded = await runtime.navigate(identity, signal, { viewId, url: pageUrl })
  check('the sandbox UI reloads', reloaded.ok === true, JSON.stringify(reloaded.data ?? '').slice(0, 80))
  await runtime.waitFor(identity, signal, { viewId, loadState: 'load', timeoutMs: 30_000 }).catch(() => undefined)
  await sleep(2500)
  await dismissModal()
  const afterReload = String(await badgeText())
  check('the controller selection survives a page reload', /已锁定|DSH BrowserWorkbench/.test(afterReload), afterReload.slice(0, 120))

  const consoleOut = await runtime.consoleMessages(identity, signal, { viewId })
  const consoleErrors = (consoleOut.data?.messages ?? []).filter(item => item.level === 'error')
  check('the reloaded UI stays error free', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)).slice(0, 240))
} finally {
  await runtime.dispose?.().catch(() => undefined)
  await browser.close()
}

const failed = results.filter(item => item.status === 'FAIL').length
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
await writeFile(join(reportDir, `rpc-${stamp}.json`), JSON.stringify({ stamp, origin, total: results.length, failed, results }, null, 2))
await writeFile(join(reportDir, `rpc-${stamp}.md`), [
  `# RPC + persistence verification (${stamp})`,
  '',
  `- endpoint: ${origin}`,
  `- checks: ${results.length} · failed: ${failed}`,
  '',
  '| # | check | status | detail |',
  '| --- | --- | --- | --- |',
  ...results.map((item, index) => `| ${index + 1} | ${item.name} | ${item.status} | ${String(item.detail ?? '').replace(/\|/g, '\\|').slice(0, 160)} |`),
  '',
].join('\n'))
console.log(`\n${results.length - failed}/${results.length} RPC checks passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
