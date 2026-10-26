// Panel-body verification: with model credentials available the sandbox session can
// become a formal Agent Session, which is what the sidebar.right.pane.tab panel needs.
// This script drives the real Web UI (composer control -> controller menu -> panel tab)
// and checks that all nine views render and that Provider / Live actually work.
//
//   DSH_VERIFY_URL=... DSH_VERIFY_TOKEN=... node --experimental-transform-types scripts/verify/e2e-panel.mjs
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { launchBrowser } from './browser.mjs'
import { startFixtureServer } from './fixtures.mjs'
import { BrowserRuntime } from '../../src/runtime/runtime.ts'
import { resolveConfig } from '../../src/domain/policy.ts'

const root = resolve(import.meta.dirname, '..', '..')
const sandboxRoot = join(root, '.sandbox')
const artifactRoot = join(sandboxRoot, 'artifacts')
const reportDir = join(sandboxRoot, 'reports')
await mkdir(artifactRoot, { recursive: true })
await mkdir(reportDir, { recursive: true })

const pageUrl = process.env.DSH_VERIFY_URL ?? ''
const token = process.env.DSH_VERIFY_TOKEN ?? ''
const keepAlive = process.argv.includes('--keep-alive')
if (pageUrl === '' || token === '') {
  console.error('DSH_VERIFY_URL and DSH_VERIFY_TOKEN are required (see the sandbox boot log)')
  process.exit(2)
}

// The controller menu and the agent-preset menu both carry a "menu" class; the preset
// anchor (menuAnchor) must be skipped or the wrong node wins.
const menuExpr = "[...document.querySelectorAll('[class*=\"menu\"]')].filter(node => !/menuAnchor/.test(String(node.className))).at(-1) ?? null"

const results = []
const record = (name, status, detail) => {
  results.push({ name, status, detail })
  console.log(`${status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : 'FAIL'} ${name}${detail === undefined ? '' : ` :: ${detail}`}`)
}
const check = (name, ok, detail) => record(name, ok ? 'PASS' : 'FAIL', detail)
const sleep = ms => new Promise(done => setTimeout(done, ms))

const browser = await launchBrowser({ sandboxRoot, headless: true })
const fixture = await startFixtureServer()
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

const identity = { sessionId: 'verify-panel', sessionCreatedAt: Date.now(), callId: 'verify-panel', rootCallId: 'verify-panel' }
const signal = AbortSignal.timeout(900_000)

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
const shot = async (name) => {
  // Playwright's 30s screenshot budget can expire while the panel streams
  // screencast frames; retry once, then degrade to SKIP instead of failing the
  // functional check that already ran.
  let out
  let lastError
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      out = await runtime.screenshot(identity, signal, { viewId })
      break
    } catch (error) {
      lastError = error
      await sleep(750)
    }
  }
  if (out === undefined) {
    record(`screenshot ${name}`, 'SKIP', String(lastError).split('\n')[0].slice(0, 200))
    return undefined
  }
  const file = join(artifactRoot, `panel-${name}.png`)
  if (typeof out.data?.base64 === 'string') {
    await writeFile(file, Buffer.from(out.data.base64, 'base64'))
    return file
  }
  if (typeof out.data?.path === 'string') {
    await copyFile(out.data.path, file)
    return file
  }
  return undefined
}
const refFor = async (selector, targetViewId = viewId) => {
  const out = await runtime.query(identity, signal, { viewId: targetViewId, selector, field: 'refs' })
  const ref = (out.data?.refs ?? [])[0]?.ref
  if (ref === undefined) throw new Error(`no ref for ${selector}`)
  return ref
}

const menuInfoExpr = `(() => {
  const menu = ${menuExpr}
  if (menu === null) return { text: '', visible: false, buttons: [] }
  const visible = menu.offsetParent !== null && menu.getClientRects().length > 0
  return {
    text: (menu.textContent || '').replace(/\\s+/g, ' ').trim(),
    visible,
    buttons: [...menu.querySelectorAll('button')].map(node => (node.textContent || '').trim()),
  }
})()`
const menuTextNow = async () => {
  const info = await ev(menuInfoExpr)
  return info.visible === true ? info.text : ''
}
const openMenu = async () => {
  const text = await menuTextNow()
  if (text !== '') return text
  await ev(`(() => {
    const button = document.querySelector('[class*="controlButton"]')
    if (!button) return false
    button.click()
    return true
  })()`)
  await sleep(700)
  return menuTextNow()
}
// The controller menu is a popover that closes on outside clicks, and the panel view
// buttons live inside it. Search visible buttons document-wide and prefer the controller
// menu, so a stale hidden copy can never win.
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
    if (node === undefined) {
      const all = [...document.querySelectorAll('button')]
        .filter(item => item.offsetParent !== null && item.getClientRects().length > 0)
        .map(item => (item.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter(Boolean)
      const control = document.querySelector('[class*="controlButton"]')
      const slot = document.querySelector('[data-dsh-slot="conversation.input.right"]')
      return {
        clicked: false,
        reason: 'missing',
        all: all.slice(0, 60),
        control: control === null ? null : (control.textContent || '').trim(),
        slot: slot === null ? null : slot.outerHTML.slice(0, 600),
        errors: (window.__verifyErrors ?? []).slice(-6),
      }
    }
    node.click()
    return { clicked: true }
  })()`)
  await sleep(800)
  return out
}

try {
  const connected = await runtime.provider(identity, signal, { action: 'connect', endpoint: browser.endpoint })
  check('probe runtime connected to Chrome', connected.ok === true, JSON.stringify(connected.data?.active ?? connected.data).slice(0, 120))

  const opened = await runtime.tabs(identity, signal, { action: 'new', url: pageUrl })
  viewId = opened.viewId
  await runtime.waitFor(identity, signal, { viewId, loadState: 'load', timeoutMs: 30_000 })
  // A narrow window makes the right sidebar take over the whole viewport, which unmounts
  // the composer (and its controller control). Widen the emulated viewport so the sidebar
  // stays a column next to the conversation.
  await runtime.emulate(identity, signal, { viewId, action: 'viewport', width: 1600, height: 1000, deviceScaleFactor: 1 })
  await sleep(1200)

  // Dismiss the release-notes modal if this profile still shows it.
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

  // Record page-side errors so a crashed slot is visible even without console history.
  await ev(`(() => {
    window.__verifyErrors = []
    window.addEventListener('error', event => window.__verifyErrors.push(String(event.message || event.error)))
    window.addEventListener('unhandledrejection', event => window.__verifyErrors.push('rejection: ' + String(event.reason)))
    return true
  })()`)

  // The web client restores the last conversation of the profile, so start from a fresh
  // blank Session; otherwise a previous run's locked controller leaks into this check.
  await ev(`(() => {
    const node = [...document.querySelectorAll('button')].find(item => (item.textContent || '').replace(/\\s+/g, '') === '新会话')
    if (node === null || node === undefined) return false
    node.click()
    return true
  })()`)
  await sleep(1500)

  const model = await ev(`(() => {
    const node = document.querySelector('[aria-label^="选择模型"]')
    return node === null ? null : { label: node.getAttribute('aria-label'), text: (node.textContent || '').trim() }
  })()`)
  check('model credentials reached the sandbox (a model is selectable)', /DeepSeek|Flash|Pro/i.test(String(model?.text ?? '')), JSON.stringify(model).slice(0, 160))

  // ---- 1. Send one message so the blank session becomes a formal Agent Session.
  const composerRef = await refFor('[data-composer-input="true"]')
  await runtime.elementAction(identity, signal, { viewId, action: 'type', ref: composerRef, text: '只回复 OK', submit: false })
  const typed = await ev(`(() => {
    const node = document.querySelector('[data-composer-input="true"]')
    return (node?.innerText ?? '').trim()
  })()`)
  check('composer accepted typed text', String(typed).includes('OK'), String(typed).slice(0, 80))
  const sendRef = await refFor('button[aria-label="发送消息"]')
  await runtime.elementAction(identity, signal, { viewId, action: 'click', ref: sendRef })
  const submitted = await waitUntil(`(() => {
    const node = document.querySelector('[data-composer-input="true"]')
    return node !== null && (node.innerText || '').trim() === ''
  })()`, 20_000, 'composer to clear after send')
  check('message submitted (composer cleared)', submitted === true)

  // The composer badge keeps reading "尚未选择浏览器工具" while no controller is picked,
  // so the formal-session signal is the activation button: it stays disabled while the
  // session is still the temporary blank one.
  const activateUnlocked = async () => {
    await openMenu()
    return ev(`(() => {
      const menu = ${menuExpr}
      const node = [...(menu?.querySelectorAll('button') ?? [])].find(item => (item.textContent || '').trim() === '使用 DSH BrowserWorkbench')
      return node !== undefined && node.disabled === false
    })()`)
  }
  let sessionFormal = false
  const formalDeadline = Date.now() + 120_000
  while (Date.now() < formalDeadline) {
    sessionFormal = await activateUnlocked().catch(() => false)
    if (sessionFormal) break
    await sleep(1200)
  }
  check('session became formal (workbench activation unlocked)', sessionFormal === true, (await menuTextNow()).slice(0, 200))

  // ---- 2. Claim BrowserWorkbench for this session through the composer menu.
  const menuText = await openMenu()
  check('controller menu lists the workbench option', /DSH BrowserWorkbench/.test(menuText), menuText.slice(0, 200))
  const picked = await clickMenuButton('使用 DSH BrowserWorkbench')
  check('workbench option is clickable for a formal session', picked?.clicked === true, JSON.stringify(picked))
  const confirmed = await clickMenuButton('确认选择')
  check('activation confirmed', confirmed?.clicked === true, JSON.stringify(confirmed))
  const activeState = await waitUntil(`(() => {
    const menu = ${menuExpr}
    return menu !== null && /打开 BrowserWorkbench 标签|关闭 BrowserWorkbench 标签/.test(menu.textContent || '')
  })()`, 30_000, 'controller menu to show the active branch')
  check('session now owns BrowserWorkbench', activeState === true, (await menuTextNow()).slice(0, 220))

  // ---- 3. Open the panel body in the right sidebar. The panel opens on the live view,
  // which renders no header (only non-live views do), so the mount marker is [data-live].
  const openedPanel = await clickMenuButton('打开 BrowserWorkbench 标签')
  check('panel tab requested', openedPanel?.clicked === true, JSON.stringify(openedPanel))

  const panelStateExpr = `(() => {
    const root = document.querySelector('[data-live]') ?? document.querySelector('[aria-label="关闭右侧浏览器"]')?.closest('section') ?? null
    const canvas = root === null ? null : root.querySelector('canvas')
    const frame = root === null ? null : root.querySelector('img[src^="data:image"]')
    return {
      mounted: root !== null,
      header: root === null ? '' : ((root.querySelector('header strong')?.textContent) ?? '').trim(),
      text: (root?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 320),
      buttons: root === null ? [] : [...root.querySelectorAll('button')].map(node => (node.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 24),
      canvas: canvas === null ? null : { width: canvas.width, height: canvas.height },
      hasFrame: frame !== null,
    }
  })()`

  const panelState = () => ev(panelStateExpr)
  const switchView = async (label) => {
    await openMenu()
    const clicked = await clickMenuButton(label)
    await sleep(1200)
    return { clicked, state: await panelState() }
  }

  const mounted = await waitUntil(`(${panelStateExpr}).mounted === true`, 30_000, 'panel body to mount')
  const composerProbe = await ev(`(() => {
    const slot = document.querySelector('[data-slot="conversation.input.right"]')
    const browserNodes = [...document.querySelectorAll('button, span, div')]
      .filter(node => (node.textContent || '').trim() === '浏览器' && node.children.length === 0)
      .map(node => ({ tag: node.tagName, cls: String(node.className).slice(0, 60), rects: node.getClientRects().length }))
    return {
      slotFound: slot !== null,
      slotDisplay: slot === null ? null : getComputedStyle(slot).display,
      slotHtml: slot === null ? null : slot.outerHTML.slice(0, 700),
      slotRects: slot === null ? 0 : slot.getClientRects().length,
      browserNodes: browserNodes.slice(0, 8),
      composerHtmlTail: (document.querySelector('[data-slot="conversation.composer.bar"]')?.outerHTML ?? '').slice(-1200),
    }
  })()`)
  await shot('panel-open')
  const slotErrors = await runtime.consoleMessages(identity, signal, { viewId })
  check('panel body mounted in sidebar.right.pane.tab', mounted === true, JSON.stringify({ panel: await panelState(), composer: composerProbe }).slice(0, 700))
  check('composer control slot stays healthy after the panel opens', composerProbe?.slotHtml?.includes('data-slot-error') !== true, JSON.stringify(slotErrors.data?.messages?.slice(-6)).slice(0, 1400))

  // ---- 4. Provider view first: the panel starts disconnected, so connect this probe
  // Chrome here (through the real form) before anything else can render.
  const providerView = await switchView('Provider')
  check('view provider renders', providerView.clicked?.clicked === true && providerView.state.header === 'Provider', JSON.stringify(providerView).slice(0, 320))
  const endpointRef = await refFor('input[inputmode="url"]')
  await runtime.elementAction(identity, signal, { viewId, action: 'type', ref: endpointRef, text: browser.endpoint })
  const connectButton = await ev(`(() => {
    const node = [...document.querySelectorAll('button')].find(item => (item.textContent || '').trim() === '连接浏览器')
    return node === null ? null : { text: node.textContent.trim(), disabled: node.disabled }
  })()`)
  check('provider view exposes the connect form', connectButton !== null, JSON.stringify(connectButton))
  const connectDeadline = Date.now() + 60_000
  let panelConnected = false
  while (Date.now() < connectDeadline) {
    panelConnected = await ev(`(() => /已连接浏览器/.test(document.body.textContent || ''))()`).catch(() => false)
    if (panelConnected) break
    await ev(`(() => {
      const node = [...document.querySelectorAll('button')].find(item => (item.textContent || '').trim() === '连接浏览器')
      if (node !== null && node.disabled === false) node.click()
      return node !== null
    })()`).catch(() => false)
    await sleep(1500)
  }
  check('provider view connects an existing Chrome', panelConnected === true, JSON.stringify(await panelState()).slice(0, 320))
  await shot('provider')

  // ---- 5. Every remaining view, live last so it renders an attached browser.
  const views = [
    ['诊断', 'diagnostic'],
    ['Console', 'console'],
    ['Network', 'network'],
    ['Debugger', 'debugger'],
    ['Performance', 'performance'],
    ['扩展管理', 'extensions'],
    ['Emulation', 'emulation'],
    ['实况', 'live'],
  ]
  for (const [label, key] of views) {
    const { clicked, state } = await switchView(label)
    const rendered = key === 'live'
      ? clicked?.clicked === true && state.mounted === true && (state.canvas !== null || state.hasFrame || /浏览器尚未连接/.test(state.text))
      : clicked?.clicked === true && state.header === label
    check(`view ${key} renders`, rendered === true, JSON.stringify({ click: clicked, header: state.header, text: state.text.slice(0, 120), buttons: state.buttons.slice(0, 6) }).slice(0, 420))
    if (key === 'console' || key === 'extensions' || key === 'live') await shot(key)
  }

  // ---- 6. Live view: an open panel makes adaptive sizing reachable. The live pane
  // paints CDP screencast frames into an <img> whose src is a data URL.
  const liveFrames = await waitUntil(`(() => {
    const root = document.querySelector('[data-live]') ?? document.querySelector('[aria-label="关闭右侧浏览器"]')?.closest('section') ?? null
    if (root === null) return false
    const frame = root.querySelector('img[src^="data:image"]')
    return frame !== null && frame.naturalWidth > 0 && frame.naturalHeight > 0
  })()`, 45_000, 'live screencast frame to arrive')
  const frameInfo = await ev(`(() => {
    const root = document.querySelector('[data-live]') ?? null
    const frame = root === null ? null : root.querySelector('img[src^="data:image"]')
    return frame === null ? null : { width: frame.naturalWidth, height: frame.naturalHeight, bytes: frame.src.length }
  })()`)
  check('live view receives screencast frames', liveFrames === true, JSON.stringify(frameInfo))
  const adaptive = await ev(`(() => {
    const node = [...document.querySelectorAll('button')].find(item => /自适应/.test(item.textContent || ''))
    if (!node) return { clicked: false, labels: [...document.querySelectorAll('button')].map(item => (item.textContent || '').trim()).filter(Boolean).slice(0, 30) }
    node.click()
    return { clicked: true }
  })()`)
  await sleep(2000)
  const alertText = await ev(`(() => {
    const alert = document.querySelector('[role="alert"]')
    return alert === null ? '' : (alert.textContent || '').trim()
  })()`)
  check('live view adaptive mode applies inside the open panel', adaptive?.clicked === true && !/ADAPTIVE_SIZE_UNAVAILABLE|available size/.test(String(alertText)), JSON.stringify(adaptive).slice(0, 240) + ` :: ${String(alertText).slice(0, 120)}`)
  await shot('live-adaptive')

  // ---- 7. Human takeover: drive the panel itself (new tab, address bar, takeover button),
  // then send real Playwright pointer and keyboard input. While the human owns control the
  // plugin rejects model reads, so read the page back over a second CDP connection.
  const driver = await chromium.connectOverCDP(browser.endpoint)
  const driverContext = driver.contexts()[0]
  const uiPage = driverContext.pages().find(page => page.url().startsWith(new URL(pageUrl).origin)) ?? driverContext.pages()[0]
  await switchView('实况')
  const fixtureUrl = `${fixture.base}/input.html?panel=1`
  await uiPage.locator('button[aria-label="新建浏览器标签"]').click()
  const address = uiPage.locator('input[aria-label="浏览器地址"]')
  await address.fill(fixtureUrl)
  await address.press('Enter')
  let targetPage
  const targetDeadline = Date.now() + 30_000
  while (targetPage === undefined && Date.now() < targetDeadline) {
    await sleep(300)
    targetPage = driverContext.pages().find(page => page.url().includes('/input.html?panel=1'))
  }
  if (targetPage === undefined) throw new Error('the panel never opened the input fixture')
  check('panel address bar navigates a new tab to the fixture', true, fixtureUrl)
  const readPage = () => targetPage.evaluate(() => {
    const field = document.getElementById('echo')
    return { active: document.activeElement?.id ?? '', events: (window.__events ?? []).slice(-12), value: field === null ? null : field.value }
  })
  const frameDeadline = Date.now() + 30_000
  let fixtureFrame = false
  while (!fixtureFrame && Date.now() < frameDeadline) {
    fixtureFrame = await uiPage.evaluate(() => {
      const img = document.querySelector('[data-live] img[src^="data:image"]')
      return img !== null && img.naturalWidth > 0
    })
    if (!fixtureFrame) await sleep(300)
  }
  if (!fixtureFrame) throw new Error('the live pane never showed the fixture frame')
  const liveRect = () => uiPage.evaluate(() => {
    const img = document.querySelector('[data-live] img[src^="data:image"]')
    if (img === null) return null
    const rect = img.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
  const clickInfo = () => uiPage.evaluate(() => {
    const img = document.querySelector('[data-live] img[src^="data:image"]')
    if (img === null) return { img: null }
    const rect = img.getBoundingClientRect()
    const x = rect.x + rect.width / 2
    const y = rect.y + rect.height / 2
    const top = document.elementFromPoint(x, y)
    return {
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      tabIndex: img.tabIndex,
      pointerEvents: getComputedStyle(img).pointerEvents,
      top: top === null ? null : { tag: top.tagName, cls: String(top.className).slice(0, 80), aria: top.getAttribute('aria-label') },
    }
  })
  const clickLive = async () => {
    const rect = await liveRect()
    if (rect === null || rect.width < 10 || rect.height < 10) throw new Error('the live pane is not visible')
    await uiPage.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2)
    await sleep(1000)
  }

  const before = await readPage()
  await clickLive()
  const idle = await readPage()
  check('live clicks are ignored until the human owns control', idle.events.length === before.events.length && idle.active !== 'echo', JSON.stringify(idle).slice(0, 240))

  // Real human input has to start from the panel control: only the session that owns the
  // browser can hand control to the person in front of the screen.
  const clickPanelButton = async (label) => {
    const clickedButton = await uiPage.evaluate((name) => {
      const root = document.querySelector('[data-live]')
      if (root === null) return false
      const details = root.querySelector('details')
      if (details !== null && !details.open) details.open = true
      const button = [...root.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === name || node.textContent.trim() === name)
      if (button === undefined || button === null) return false
      button.click()
      return true
    }, label)
    if (!clickedButton) throw new Error(`panel button not found: ${label}`)
    await sleep(600)
  }
  const waitForUserControl = async (expected) => {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const state = await uiPage.evaluate(() => {
        const img = document.querySelector('[data-live] img[src^="data:image"]')
        return { focusable: img !== null && img.tabIndex === 0, text: document.querySelector('[data-live]')?.textContent ?? '' }
      })
      if (expected === state.focusable) return state.text.includes(expected ? '人工控制中' : '模型控制中')
      await sleep(300)
    }
    return false
  }

  await clickPanelButton('人工接管浏览器')
  check('panel takeover button switches the live pane to human control', await waitForUserControl(true), await uiPage.evaluate(() => document.querySelector('[data-live]')?.textContent?.slice(0, 200) ?? ''))

  await clickLive()
  await sleep(400)
  await clickLive()
  const clicked = await readPage()
  check('real pointer input reaches the page after takeover', clicked.active === 'echo' && clicked.events.includes('pointerdown') && clicked.events.includes('mousedown'), `${JSON.stringify(clicked).slice(0, 200)} click=${JSON.stringify(await clickInfo()).slice(0, 240)}`)

  await uiPage.keyboard.type('hello', { delay: 50 })
  await sleep(1500)
  const typedField = await readPage()
  check('real keyboard input reaches the page after takeover', typedField.value === 'hello', JSON.stringify(typedField).slice(0, 260))

  await clickPanelButton('归还浏览器控制权给模型')
  check('panel return button hands control back to the model', await waitForUserControl(false), await uiPage.evaluate(() => document.querySelector('[data-live]')?.textContent?.slice(0, 200) ?? ''))
  const beforeReturnClick = await readPage()
  await clickLive()
  const afterReturn = await readPage()
  check('live clicks are ignored again after control returns', afterReturn.events.length === beforeReturnClick.events.length, `${beforeReturnClick.events.length} -> ${afterReturn.events.length}`)

  await shot('demo-final')
  await driver.close().catch(() => {})

  const consoleOut = await runtime.consoleMessages(identity, signal, { viewId })
  const errors = (consoleOut.data?.messages ?? []).filter(message => message.level === 'error')
  check('no console errors while driving the panel', errors.length === 0, JSON.stringify(errors.slice(0, 3)).slice(0, 400))
} catch (error) {
  record('panel verification', 'FAIL', String(error?.stack ?? error).slice(0, 700))
} finally {
  if (!keepAlive) {
    await runtime.dispose().catch(() => {})
    await browser.close().catch(() => {})
    await fixture.close().catch(() => {})
  }
}

const failed = results.filter(item => item.status === 'FAIL').length
const skipped = results.filter(item => item.status === 'SKIP').length
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const report = { generatedAt: new Date().toISOString(), pageUrl: pageUrl.replace(/token=[^&]+/, 'token=***'), total: results.length, passed: results.length - failed - skipped, skipped, failed, results }
await writeFile(join(reportDir, `panel-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`\n${report.passed}/${report.total} panel checks passed, ${skipped} skipped, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
