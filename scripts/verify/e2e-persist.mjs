// Cross-restart persistence: phase "prepare" claims BrowserWorkbench in a real Session and
// records the marker text; the operator restarts the sandbox Host; phase "verify" reopens the
// web UI and checks the controller selection survived (badge locked + menu offers the panel).
//
//   node --experimental-transform-types scripts/verify/e2e-persist.mjs --phase=prepare
//   ... restart the sandbox Host ...
//   node --experimental-transform-types scripts/verify/e2e-persist.mjs --phase=verify
import { chromium } from 'playwright-core'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BrowserRuntime } from '../../src/runtime/runtime.ts'
import { resolveConfig } from '../../src/domain/policy.ts'
import { launchBrowser } from './browser.mjs'

const root = resolve('.')
const reportDir = join(root, '.sandbox', 'reports')
const statePath = join(root, '.sandbox', 'persist-state.json')
const phaseArg = process.argv.find(item => item.startsWith('--phase='))
const phase = phaseArg === undefined ? 'prepare' : phaseArg.slice('--phase='.length)
const pageUrl = process.env.DSH_VERIFY_URL
if (pageUrl === undefined || pageUrl === '') throw new Error('DSH_VERIFY_URL is required')

await mkdir(reportDir, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 400) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` :: ${String(detail).slice(0, 200)}`}`)
}
const sleep = ms => new Promise(done => setTimeout(done, ms))

const writable = {
  async saveImage() {
    return { ok: true, value: { id: 'verify-image' } }
  },
}
const config = resolveConfig({
  headless: true,
  artifactRoot: join(root, '.sandbox', 'artifacts'),
})
const runtime = new BrowserRuntime(config, writable)
const identity = { sessionId: `verify-persist-${phase}`, sessionCreatedAt: Date.now(), callId: `call-${phase}`, rootCallId: `root-${phase}` }
const signal = new AbortController().signal

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
    await sleep(300)
  }
  throw new Error(`timed out waiting for ${label}`)
}

const menuExpr = `(() => {
  const candidates = [...document.querySelectorAll('[class*="menu"]')]
    .filter(node => !/menuAnchor/.test(String(node.className || '')))
    .filter(node => node.offsetParent !== null && node.getClientRects().length > 0)
  return candidates.at(-1) ?? null
})()`
const openMenu = async () => {
  const already = await ev(`(() => { const menu = ${menuExpr}; return menu !== null && (menu.textContent || '').includes('DSH BrowserWorkbench') })()`)
  if (!already) {
    await ev(`(() => {
      const button = document.querySelector('[class*="controlButton"]')
      if (button === null) return false
      button.click()
      return true
    })()`)
    await sleep(800)
  }
  return ev(`(() => { const menu = ${menuExpr}; return menu === null ? '' : (menu.textContent || '') })()`)
}
const clickMenuButton = async (label) => {
  const out = await ev(`(() => {
    const wanted = ${JSON.stringify(label)}
    const candidates = [...document.querySelectorAll('button')].filter(node => (node.textContent || '').trim() === wanted && !node.disabled)
      .filter(node => node.offsetParent !== null && node.getClientRects().length > 0)
    const inMenu = candidates.filter(node => {
      const host = node.closest('[class*="menu"]')
      return host !== null && !/menuAnchor/.test(String(host.className))
    })
    const node = inMenu.at(-1) ?? candidates.at(-1)
    if (node === undefined) return { clicked: false, all: candidates.map(item => (item.textContent || '').trim()).slice(0, 20) }
    node.click()
    return { clicked: true }
  })()`)
  await sleep(800)
  return out
}
const dismissReleaseNotes = async () => {
  await ev(`(async () => {
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
}
const badgeText = async () => ev(`(() => {
  const node = document.querySelector('[class*="controllerBadge"]')
  return node === null ? '' : (node.textContent || '').trim()
})()`)
// The sidebar folds long histories into "展开其余 N 个会话" rows; open them all so the
// recorded conversation can be clicked by its marker.
const expandCollapsedSessions = async () => {
  for (let round = 0; round < 8; round += 1) {
    const clicked = await ev(`(() => {
      const label = text => (text || '').replace(/\\s+/g, '')
      const node = [...document.querySelectorAll('button, [role="button"]')]
        .find(item => item.offsetParent !== null && /^展开其余\\d+个会话$/.test(label(item.textContent)))
      if (node === undefined) return false
      node.click()
      return true
    })()`)
    if (clicked !== true) return round
    await sleep(500)
  }
  return 8
}
const pickSessionByText = async (marker) => {
  let last = { clicked: false }
  for (let round = 0; round < 20; round += 1) {
    last = await ev(`(() => {
      const wanted = ${JSON.stringify(marker)}
      const label = text => (text || '').replace(/\\s+/g, ' ').trim()
      const visible = node => node.offsetParent !== null && node.getClientRects().length > 0
      const holds = [...document.querySelectorAll('div, span, a, li, button, [role="button"], [role="option"]')]
        .filter(node => visible(node) && label(node.textContent).includes(wanted))
      // The row wrapper is the outermost match that is not a whole page container.
      const row = holds.filter(node => label(node.textContent).length <= wanted.length + 40).at(-1) ?? holds.at(-1)
      if (row !== undefined) {
        row.click()
        return { clicked: true, tag: row.tagName, text: label(row.textContent).slice(0, 80) }
      }
      const labels = [...document.querySelectorAll('button, [role="button"], a')]
        .filter(item => visible(item))
        .map(item => label(item.textContent))
        .filter(Boolean)
      return { clicked: false, bodyHasMarker: label(document.body.textContent).includes(wanted), bodyText: label(document.body.textContent).slice(0, 1200), sidebar: labels.slice(0, 40) }
    })()`)
    if (last.clicked === true) return last
    await sleep(500)
  }
  return last
}
const refFor = async (selector) => {
  const out = await runtime.query(identity, signal, { viewId, selector, field: 'refs', limit: 5 })
  const ref = out.data?.refs?.[0]?.ref
  if (typeof ref !== 'string' || ref === '') throw new Error(`no visible ref for ${selector}`)
  return ref
}

let browser
try {
  browser = await launchBrowser({ sandboxRoot: join(root, '.sandbox') })
  const connected = await runtime.provider(identity, signal, { action: 'connect', endpoint: browser.endpoint })
  check('runtime connected to Chrome', connected.ok === true, JSON.stringify(connected.data?.active ?? connected.data).slice(0, 120))

  const opened = await runtime.tabs(identity, signal, { action: 'new', url: pageUrl })
  viewId = opened.viewId
  await runtime.waitFor(identity, signal, { viewId, loadState: 'load', timeoutMs: 30_000 })
  await runtime.emulate(identity, signal, { viewId, action: 'viewport', width: 1600, height: 1000, deviceScaleFactor: 1 })
  await sleep(1200)
  await dismissReleaseNotes()

  if (phase === 'inspect') {
    const snapshot = await ev(`(() => {
      const text = document.body.innerText || ''
      const aside = document.querySelector('aside, [class*="sidebar"], [data-slot*="sidebar"]')
      return {
        hasMarker: text.includes('持久化验证'),
        inputs: [...document.querySelectorAll('input, textarea')].map(node => ({ tag: node.tagName, label: node.getAttribute('aria-label'), placeholder: node.getAttribute('placeholder') })).slice(0, 20),
        asideText: aside === null ? '' : (aside.innerText || '').slice(0, 2500),
        textHead: text.slice(0, 1200)
      }
    })()`)
    console.log(JSON.stringify(snapshot, null, 2))
  } else if (phase === 'prepare') {
    const marker = `持久化验证 ${Date.now().toString(36)}`
    await ev(`(() => {
      const node = [...document.querySelectorAll('button')].find(item => (item.textContent || '').replace(/\\s+/g, '') === '新会话')
      if (node === null || node === undefined) return false
      node.click()
      return true
    })()`)
    await sleep(1500)

    const composerRef = await refFor('[data-composer-input="true"]')
    await runtime.elementAction(identity, signal, { viewId, action: 'type', ref: composerRef, text: marker, submit: false })
    const sendRef = await refFor('button[aria-label="发送消息"]')
    await runtime.elementAction(identity, signal, { viewId, action: 'click', ref: sendRef })
    await waitUntil(`(() => {
      const node = document.querySelector('[data-composer-input="true"]')
      return node !== null && (node.innerText || '').trim() === ''
    })()`, 30_000, 'composer to clear after send')
    check('message submitted before restart', true, marker)

    let formal = false
    const formalDeadline = Date.now() + 120_000
    while (Date.now() < formalDeadline) {
      await openMenu()
      formal = await ev(`(() => {
        const menu = ${menuExpr}
        const node = [...(menu?.querySelectorAll('button') ?? [])].find(item => (item.textContent || '').trim() === '使用 DSH BrowserWorkbench')
        return node !== undefined && node.disabled === false
      })()`)
      if (formal) break
      await sleep(1200)
    }
    check('session became formal before restart', formal === true)

    await openMenu()
    const picked = await clickMenuButton('使用 DSH BrowserWorkbench')
    const confirmed = await clickMenuButton('确认选择')
    check('activation clicks reached the controller menu', picked?.clicked === true && confirmed?.clicked === true, JSON.stringify({ picked, confirmed }).slice(0, 240))
    // The controller menu closes on every pick, so the badge is the durable evidence that the
    // selection landed. Activation can lag behind the confirm click by a few seconds.
    let claimBadge = ''
    const claimDeadline = Date.now() + 60_000
    while (Date.now() < claimDeadline) {
      claimBadge = await badgeText()
      if (/已锁定/.test(claimBadge)) break
      await sleep(1000)
    }
    check('workbench claimed before restart', /已锁定/.test(claimBadge), claimBadge)
    let openedPanel = { clicked: false }
    const panelDeadline = Date.now() + 60_000
    while (Date.now() < panelDeadline) {
      await openMenu()
      openedPanel = await clickMenuButton('打开 BrowserWorkbench 标签')
      if (openedPanel?.clicked === true) break
      await sleep(1200)
    }
    const mounted = await waitUntil(`document.querySelector('[data-live]') !== null`, 20_000, 'panel mount').catch(() => false)
    check('panel opened before restart', openedPanel?.clicked === true && mounted === true, JSON.stringify(openedPanel).slice(0, 200))

    const badge = await badgeText()
    check('controller badge is locked before restart', /已锁定/.test(badge), badge)
    await writeFile(statePath, `${JSON.stringify({ marker, badge, savedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
    console.log(`PREPARED ${marker}`)
  } else if (phase === 'verify') {
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    const marker = state.marker
    // Session rows live behind the sidebar search; Playwright pierces the render tree that the
    // evaluate-only helpers cannot see, so drive the filter with a real locator.
    const driver = await chromium.connectOverCDP(browser.endpoint)
    const pages = driver.contexts().flatMap(context => context.pages())
    const uiPage = pages.find(page => page.url().startsWith('http://127.0.0.1:31880')) ?? pages[0]
    const search = uiPage.locator('input[placeholder="搜索会话名称"]')
    await search.fill(marker)
    await sleep(1200)
    const row = uiPage.getByText(marker, { exact: false }).first()
    const listed = (await row.count()) > 0
    check('recorded session is listed after Host restart', listed, marker)
    if (listed) await row.click()
    // The client fetches the session projection after the click; the badge turns "locked" only
    // once that projection lands, so poll instead of assuming a fixed delay.
    let badge = ''
    const badgeDeadline = Date.now() + 25_000
    while (Date.now() < badgeDeadline) {
      badge = await uiPage.locator('[class*="controllerBadge"]').first().innerText().catch(() => '')
      if (/已锁定/.test(badge)) break
      await sleep(500)
    }
    check('controller selection survived the Host restart', /已锁定/.test(badge), badge)
    let menuText = ''
    let reopened = { clicked: false }
    const reopenDeadline = Date.now() + 30_000
    while (Date.now() < reopenDeadline) {
      menuText = await openMenu()
      if (!/打开 BrowserWorkbench 标签|关闭 BrowserWorkbench 标签/.test(menuText)) {
        await sleep(800)
        continue
      }
      reopened = await clickMenuButton('打开 BrowserWorkbench 标签')
      if (reopened?.clicked === true) break
      await sleep(800)
    }
    check('controller menu still offers the panel', /打开 BrowserWorkbench 标签|关闭 BrowserWorkbench 标签/.test(menuText), menuText.slice(0, 200))
    const mounted = await waitUntil(`document.querySelector('[data-live]') !== null`, 25_000, 'panel mount after restart').catch(() => false)
    check('panel reopens after the Host restart', reopened?.clicked === true && mounted === true, JSON.stringify(reopened).slice(0, 200))
    await driver.close().catch(() => {})
  }
} catch (error) {
  check(`${phase} phase`, false, String(error?.stack ?? error).slice(0, 600))
} finally {
  await runtime.dispose().catch(() => {})
  await browser?.close().catch(() => {})
}

const failed = results.filter(item => item.status === 'FAIL').length
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
await writeFile(join(reportDir, `persist-${phase}-${stamp}.json`), `${JSON.stringify({ phase, total: results.length, failed, results }, null, 2)}\n`, 'utf8')
console.log(`\n${results.length - failed}/${results.length} persistence checks passed (${phase})`)
process.exitCode = failed === 0 ? 0 : 1
