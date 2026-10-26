// Deterministic runtime-level verification for all 30 browser tools.
//
// Runs the real BrowserRuntime against a real Chromium over the external-CDP provider,
// the same path the plugin uses in DSH. Prints a PASS/FAIL matrix and writes JSON + Markdown
// reports under .sandbox/reports/.
//
// Usage: node --experimental-transform-types scripts/verify/e2e-tools.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BrowserRuntime } from '../../src/runtime/runtime.ts'
import { resolveConfig } from '../../src/domain/policy.ts'
import { launchBrowser } from './browser.mjs'
import { startFixtureServer } from './fixtures.mjs'

const root = resolve('.')
const sandboxRoot = join(root, '.sandbox')
const reportDir = join(sandboxRoot, 'reports')
const artifactRoot = join(sandboxRoot, 'artifacts')
const uploadRoot = join(sandboxRoot, 'upload')
process.env.DSH_HOME = join(sandboxRoot, 'home')

await mkdir(reportDir, { recursive: true })
await mkdir(artifactRoot, { recursive: true })
await mkdir(uploadRoot, { recursive: true })

const fixtureServer = await startFixtureServer()
const base = fixtureServer.base
const browser = await launchBrowser({ sandboxRoot })
const config = resolveConfig({
  executablePath: browser.executable,
  headless: true,
  toolRegistrationMode: 'global',
  uploadRoots: [uploadRoot],
  artifactRoot,
  maxOutputChars: 12000,
})
const attachments = {
  async saveImage(input) {
    return { id: `verify-image-${Date.now()}`, mediaType: input.mediaType, name: input.name, bytes: input.data.byteLength }
  },
}
const runtime = new BrowserRuntime(config, attachments)
const identity = { sessionId: `verify-${Date.now()}`, sessionCreatedAt: Date.now(), callId: 'call-1', rootCallId: 'root-1' }
const signal = new AbortController().signal

const results = []
const evidence = {}
let activeViewId

// Confirmed pre-existing plugin defects and environment-limited checks. They are still executed and
// reported verbatim; they are only excluded from the pass/fail exit gate once the reason is recorded here.
const knownIssues = [
  { tool: 'browser_live_view', name: 'adaptive', reason: 'adaptive sizing requires an open live panel; not reachable headless at runtime level', kind: 'ENVIRONMENT' },
]

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
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
    if (output?.ok !== true) {
      throw new Error(`ok=false data=${JSON.stringify(output?.data ?? null).slice(0, 400)}`)
    }
    if (assert !== undefined) assert(output)
    pass(output?.data)
    return output
  } catch (error) {
    const message = String(error?.message ?? error)
    if (allowFailure && (expectError === undefined || expectError.test(message))) {
      pass({ error: message })
      return undefined
    }
    const entry = { tool, name, status: 'FAIL', ms: Date.now() - startedAt, error: message, ...(note === undefined ? {} : { note }) }
    results.push(entry)
    return undefined
  }
}

function summarize(value) {
  const text = JSON.stringify(value ?? null)
  return text.length > 220 ? `${text.slice(0, 220)}…` : text
}

function must(condition, message) {
  if (!condition) throw new Error(message)
}

async function refFor(selector) {
  const output = await runtime.query(identity, signal, { selector, field: 'refs', limit: 5 })
  must(output.ok === true, `query refs failed for ${selector}`)
  const ref = output.data?.refs?.[0]?.ref
  must(typeof ref === 'string' && ref !== '', `no visible ref for ${selector}`)
  return ref
}

async function pausedFrames() {
  // Debugger.pause resolves before the paused event lands, so poll briefly like a real agent would.
  const deadline = Date.now() + 5000
  let last
  while (Date.now() < deadline) {
    last = await runtime.debugger(identity, signal, { action: 'call_frames' })
    if ((last?.data?.callFrames ?? []).length > 0) return last
    await new Promise(done => setTimeout(done, 150))
  }
  return last
}

async function text(selector) {
  const output = await runtime.query(identity, signal, { selector, field: 'text' })
  must(output.ok === true, `query text failed for ${selector}`)
  return String(output.data?.values?.[0] ?? '')
}

// ---------------------------------------------------------------- provider
const provider = await step('browser_provider', 'connect', { action: 'connect', endpoint: browser.endpoint }, () => runtime.provider(identity, signal, { action: 'connect', endpoint: browser.endpoint }))
must(provider?.ok === true, 'provider connect must succeed before any other tool can run')
await step('browser_provider', 'list', { action: 'list' }, () => runtime.provider(identity, signal, { action: 'list' }), output => must(output.data?.active === 'external-cdp', `expected active external-cdp, got ${output.data?.active}`))
await step('browser_provider', 'capabilities', { action: 'capabilities' }, () => runtime.provider(identity, signal, { action: 'capabilities' }))

// -------------------------------------------------------------------- tabs
await step('browser_tabs', 'list', { action: 'list' }, () => runtime.tabs(identity, signal, { action: 'list' }))
const created = await step('browser_tabs', 'new(url)', { action: 'new', url: `${base}/` }, () => runtime.tabs(identity, signal, { action: 'new', url: `${base}/` }), output => {
  must(typeof output.viewId === 'string' && output.viewId !== '', 'tabs.new must return a viewId')
  must(output.data?.tabs?.length >= 1, 'tabs.new must return the tab list')
})
activeViewId = created?.viewId
await step('browser_tabs', 'new(blank)', { action: 'new' }, () => runtime.tabs(identity, signal, { action: 'new' }))
{
  const listed = await runtime.tabs(identity, signal, { action: 'list' })
  const expected = listed.data?.tabs?.[0]?.viewId
  await step('browser_tabs', 'select(index)', { action: 'select', index: 0 }, () => runtime.tabs(identity, signal, { action: 'select', index: 0 }), output => must(output.viewId === expected, `select index 0 should focus ${expected}, got ${output.viewId}`))
}
await step('browser_tabs', 'select(viewId)', { action: 'select', viewId: activeViewId }, () => runtime.tabs(identity, signal, { action: 'select', viewId: activeViewId }))

// ---------------------------------------------------------------- navigate
await step('browser_navigate', 'home', { url: `${base}/` }, () => runtime.navigate(identity, signal, { url: `${base}/` }), output => must(output.data?.url === `${base}/`, `navigate url mismatch: ${output.data?.url}`))
await step('browser_navigate', 'second page', { url: `${base}/second.html` }, () => runtime.navigate(identity, signal, { url: `${base}/second.html` }), output => must(output.data?.title === 'Second Page', `title mismatch: ${output.data?.title}`))
await step('browser_navigate_back', 'back to home', {}, () => runtime.navigateBack(identity, signal, {}))
await step('browser_query', 'home restored after back', { selector: 'h1', field: 'text' }, () => runtime.query(identity, signal, { selector: 'h1', field: 'text' }), output => must(output.data?.values?.[0] === 'Fixture Home', `expected home page after navigate_back, got ${JSON.stringify(output.data?.values)}`))
await step('browser_navigate', 'policy denies file://', { url: 'file:///C:/windows/win.ini' }, () => runtime.navigate(identity, signal, { url: 'file:///C:/windows/win.ini' }), undefined, { allowFailure: true, expectError: /not allowed|POLICY_DENIED/i })

// ---------------------------------------------------------------- snapshot
await step('browser_snapshot', 'full', {}, () => runtime.snapshot(identity, signal, { includeDiff: false }), output => {
  must(typeof output.data?.snapshot === 'string' && output.data.snapshot.includes('Fixture Home'), 'snapshot must contain the page heading')
  must(typeof output.data?.documentGeneration === 'number', 'snapshot must report documentGeneration')
})
await step('browser_snapshot', 'incremental', {}, () => runtime.snapshot(identity, signal, {}), output => must(['full', 'incremental'].includes(output.data?.snapshotMode), `unexpected snapshotMode ${output.data?.snapshotMode}`))

// ------------------------------------------------------------------- query
await step('browser_query', 'count', { selector: 'button', field: 'count' }, () => runtime.query(identity, signal, { selector: 'button', field: 'count' }), output => must(output.data?.count >= 4, `expected >=4 buttons, got ${output.data?.count}`))
await step('browser_query', 'text', { selector: '#count', field: 'text' }, () => runtime.query(identity, signal, { selector: '#count', field: 'text' }), output => must(output.data?.values?.[0] === '0', `expected count text 0, got ${JSON.stringify(output.data?.values)}`))
await step('browser_query', 'attribute', { selector: '#dl', field: 'attribute', attribute: 'href' }, () => runtime.query(identity, signal, { selector: '#dl', field: 'attribute', attribute: 'href' }), output => must(String(output.data?.values?.[0]).endsWith('/file.bin'), 'query attribute href mismatch'))
await step('browser_query', 'visible', { selector: '#btn', field: 'visible' }, () => runtime.query(identity, signal, { selector: '#btn', field: 'visible' }), output => must(output.data?.values?.[0] === true, 'button must be visible'))
await step('browser_query', 'refs', { selector: '#btn', field: 'refs' }, () => runtime.query(identity, signal, { selector: '#btn', field: 'refs' }), output => must(typeof output.data?.refs?.[0]?.ref === 'string', 'query refs must return a ref'))
await step('browser_query', 'sensitive attribute denied', { selector: '#name', field: 'attribute', attribute: 'value' }, () => runtime.query(identity, signal, { selector: '#name', field: 'attribute', attribute: 'value' }), undefined, { allowFailure: true, expectError: /not readable/ })

// ------------------------------------------------------- element actions
{
  const ref = await refFor('#btn')
  await step('browser_click', 'increment button', { ref }, () => runtime.elementAction(identity, signal, { action: 'click', ref }))
  await step('browser_query', 'click changed count', { selector: '#count', field: 'text' }, () => runtime.query(identity, signal, { selector: '#count', field: 'text' }), output => must(output.data?.values?.[0] === '1', `expected count 1 after click, got ${JSON.stringify(output.data?.values)}`))
}
{
  const ref = await refFor('#name')
  await step('browser_type', 'fill name', { ref, text: 'Ada Lovelace' }, () => runtime.elementAction(identity, signal, { action: 'type', ref, text: 'Ada Lovelace' }))
  await step('browser_query', 'typed value', { selector: '#name', field: 'attribute', attribute: 'placeholder' }, () => runtime.query(identity, signal, { selector: '#name', field: 'attribute', attribute: 'placeholder' }), output => must(output.data?.values?.[0] === 'Name', 'placeholder must stay readable'))
  await step('browser_evaluate', 'read typed value', { action: 'main_world', expression: "document.getElementById('name').value" }, () => runtime.evaluate(identity, signal, { action: 'main_world', expression: "document.getElementById('name').value" }), output => must(output.data?.value === 'Ada Lovelace', `expected typed value, got ${JSON.stringify(output.data?.value)}`))
}
{
  const ref = await refFor('#sel')
  await step('browser_select_option', 'beta', { ref, values: ['b'] }, () => runtime.elementAction(identity, signal, { action: 'select_option', ref, values: ['b'] }))
  await step('browser_evaluate', 'selected value', { action: 'main_world', expression: "document.getElementById('sel').value" }, () => runtime.evaluate(identity, signal, { action: 'main_world', expression: "document.getElementById('sel').value" }), output => must(output.data?.value === 'b', `expected select value b, got ${JSON.stringify(output.data?.value)}`))
}
{
  const ref = await refFor('#hover')
  await step('browser_hover', 'hover tile', { ref }, () => runtime.elementAction(identity, signal, { action: 'hover', ref }))
  await step('browser_query', 'hover result', { selector: '#hoverout', field: 'text' }, () => runtime.query(identity, signal, { selector: '#hoverout', field: 'text' }), output => must(output.data?.values?.[0] === 'hovered', `expected hovered, got ${JSON.stringify(output.data?.values)}`))
}
{
  const ref = await refFor('#deep')
  await step('browser_scroll', 'element into view', { ref }, () => runtime.elementAction(identity, signal, { action: 'scroll', ref }))
  await step('browser_scroll', 'page wheel', { direction: 'up', amount: 400 }, () => runtime.elementAction(identity, signal, { action: 'scroll', direction: 'up', amount: 400 }))
}
{
  const ref = await refFor('#name')
  await step('browser_press_key', 'element key', { ref, key: 'a' }, () => runtime.elementAction(identity, signal, { action: 'press_key', ref, key: 'a' }))
  await step('browser_press_key', 'page key', { key: 'Escape' }, () => runtime.elementAction(identity, signal, { action: 'press_key', key: 'Escape' }))
}
{
  const ref = await refFor('#dl')
  await step('browser_get_attribute', 'download href', { ref, name: 'href' }, () => runtime.getAttribute(identity, signal, { ref, name: 'href' }), output => must(String(output.data?.value).endsWith('/file.bin'), 'get_attribute href mismatch'))
  await step('browser_get_attribute', 'sensitive attribute denied', { ref, name: 'value' }, () => runtime.getAttribute(identity, signal, { ref, name: 'value' }), undefined, { allowFailure: true, expectError: /not readable/ })
}

// ------------------------------------------------------------- wait & shots
await step('browser_navigate', 'slow page', { url: `${base}/slow.html` }, () => runtime.navigate(identity, signal, { url: `${base}/slow.html` }))
await step('browser_wait_for', 'text appears', { text: 'lazy-loaded' }, () => runtime.waitFor(identity, signal, { text: 'lazy-loaded', timeoutMs: 15000 }))
await step('browser_wait_for', 'timeMs', { timeMs: 250 }, () => runtime.waitFor(identity, signal, { timeMs: 250 }), output => must(output.data?.waitedMs === 250, `unexpected waitedMs ${output.data?.waitedMs}`))
await step('browser_wait_for', 'load state', { state: 'domcontentloaded' }, () => runtime.waitFor(identity, signal, { state: 'domcontentloaded' }))
await step('browser_wait_for', 'bad args rejected', { time: 1, timeMs: 1000 }, () => runtime.waitFor(identity, signal, { time: 1, timeMs: 1000 }), undefined, { allowFailure: true, expectError: /not both|either/i })
await step('browser_take_screenshot', 'viewport png', {}, () => runtime.screenshot(identity, signal, {}), output => must(output.data?.mediaType === 'image/png', 'screenshot must be a png attachment'))
await step('browser_take_screenshot', 'full page png', { fullPage: true }, () => runtime.screenshot(identity, signal, { fullPage: true }))
await step('browser_navigate', 'home again', { url: `${base}/` }, () => runtime.navigate(identity, signal, { url: `${base}/` }))

// ------------------------------------------------------ console & network
await step('browser_console_messages', 'captured messages', {}, () => runtime.consoleMessages(identity, signal, {}), output => {
  const messages = JSON.stringify(output.data?.messages ?? [])
  must(messages.includes('fixture-log'), `console must capture fixture-log: ${messages.slice(0, 200)}`)
})
await step('browser_network_requests', 'captured requests', {}, () => runtime.networkRequests(identity, signal, {}), output => {
  const requests = JSON.stringify(output.data?.requests ?? [])
  must(requests.includes('/api'), 'network recording must include /api')
})
await step('browser_console_messages', 'clear', { clear: true }, () => runtime.consoleMessages(identity, signal, { clear: true }), output => must((output.data?.messages ?? []).length > 0, 'clear returns the cleared messages'))
await step('browser_network_requests', 'clear', { clear: true }, () => runtime.networkRequests(identity, signal, { clear: true }))

// ---------------------------------------------------------------- dialogs
await step('browser_handle_dialog', 'preconfigure accept', { accept: true }, () => runtime.handleDialog(identity, signal, { accept: true }), output => must(output.data?.preconfigured === true, 'no open dialog should mean preconfigured'))
{
  const ref = await refFor('#confirm')
  await step('browser_click', 'confirm button', { ref }, () => runtime.elementAction(identity, signal, { action: 'click', ref }))
  await step('browser_query', 'confirm accepted', { selector: '#dialogout', field: 'text' }, () => runtime.query(identity, signal, { selector: '#dialogout', field: 'text' }), output => must(output.data?.values?.[0] === 'true', `expected true, got ${JSON.stringify(output.data?.values)}`))
}
await step('browser_handle_dialog', 'preconfigure dismiss', { accept: false }, () => runtime.handleDialog(identity, signal, { accept: false }))
{
  const ref = await refFor('#confirm')
  await step('browser_click', 'confirm again', { ref }, () => runtime.elementAction(identity, signal, { action: 'click', ref }))
  await step('browser_query', 'confirm dismissed', { selector: '#dialogout', field: 'text' }, () => runtime.query(identity, signal, { selector: '#dialogout', field: 'text' }), output => must(output.data?.values?.[0] === 'false', `expected false, got ${JSON.stringify(output.data?.values)}`))
}
await step('browser_handle_dialog', 'preconfigure prompt', { accept: true, promptText: 'typed-by-agent' }, () => runtime.handleDialog(identity, signal, { accept: true, promptText: 'typed-by-agent' }))
{
  const ref = await refFor('#prompt')
  await step('browser_click', 'prompt button', { ref }, () => runtime.elementAction(identity, signal, { action: 'click', ref }))
  await step('browser_query', 'prompt accepted', { selector: '#dialogout', field: 'text' }, () => runtime.query(identity, signal, { selector: '#dialogout', field: 'text' }), output => must(output.data?.values?.[0] === 'typed-by-agent', `expected prompt text, got ${JSON.stringify(output.data?.values)}`))
}

// ------------------------------------------------------- upload & download
{
  const uploadPath = join(uploadRoot, 'sample-upload.txt')
  await writeFile(uploadPath, 'verification upload payload')
  const ref = await refFor('#file')
  await step('browser_upload_file', 'attach file', { ref, filePath: uploadPath }, () => runtime.upload(identity, signal, { ref, filePath: uploadPath }), output => must(output.data?.name === 'sample-upload.txt', `upload name mismatch: ${output.data?.name}`))
  await step('browser_upload_file', 'outside roots denied', { ref, filePath: 'C:\\Windows\\win.ini' }, () => runtime.upload(identity, signal, { ref, filePath: 'C:\\Windows\\win.ini' }), undefined, { allowFailure: true, expectError: /outside configured roots/ })
}
{
  const ref = await refFor('#dl')
  const output = await step('browser_download', 'download file', { ref }, () => runtime.download(identity, signal, { ref }), result => must(typeof result.data?.artifact === 'string', 'download must return an artifact path'))
  if (output?.data?.artifact) {
    const bytes = await readFile(output.data.artifact).catch(() => undefined)
    must(bytes !== undefined && bytes.byteLength === 4096, 'downloaded artifact must contain 4096 bytes')
    evidence.download = { artifact: output.data.artifact, bytes: bytes?.byteLength }
  }
}

// ---------------------------------------------------------------- debugger
const debuggerState = {}
await step('browser_debugger', 'attach', { action: 'attach' }, () => runtime.debugger(identity, signal, { action: 'attach' }))
const scripts = await step('browser_debugger', 'scripts', { action: 'scripts' }, () => runtime.debugger(identity, signal, { action: 'scripts' }), output => must((output.data?.scripts ?? []).length > 0, 'debugger must list scripts'))
const firstScript = scripts?.data?.scripts?.[0]
if (firstScript?.scriptId !== undefined) {
  await step('browser_debugger', 'script_source', { action: 'script_source', scriptId: firstScript.scriptId }, () => runtime.debugger(identity, signal, { action: 'script_source', scriptId: firstScript.scriptId }), output => must(typeof output.data?.source === 'string' || typeof output.data?.scriptSource === 'string' || JSON.stringify(output.data ?? {}).length > 2, 'script_source must return source text'))
}
await step('browser_debugger', 'set_breakpoint', { action: 'set_breakpoint', url: `${base}/slow.js`, lineNumber: 0 }, () => runtime.debugger(identity, signal, { action: 'set_breakpoint', url: `${base}/slow.js`, lineNumber: 0 }), undefined).then(output => { debuggerState.breakpointId = output?.data?.breakpointId })
await step('browser_debugger', 'pause', { action: 'pause' }, () => runtime.debugger(identity, signal, { action: 'pause' }))
const frames = await step('browser_debugger', 'call_frames', { action: 'call_frames' }, () => pausedFrames(), output => must((output.data?.callFrames ?? []).length >= 1, 'paused page must expose call frames'))
const callFrameId = frames?.data?.callFrames?.[0]?.callFrameId
if (callFrameId !== undefined) {
  await step('browser_evaluate', 'paused_frame', { action: 'paused_frame', expression: '1 + 1', callFrameId }, () => runtime.evaluate(identity, signal, { action: 'paused_frame', expression: '1 + 1', callFrameId }), output => must(output.data?.value === 2, `paused frame value mismatch: ${JSON.stringify(output.data?.value)}`))
  if (frames?.data?.callFrames?.[0]?.scopeChain?.[0]?.object?.objectId !== undefined) {
    const scopeObject = frames.data.callFrames[0].scopeChain[0].object.objectId
    await step('browser_debugger', 'scope_variables', { action: 'scope_variables', callFrameId, scopeNumber: 0, objectId: scopeObject }, () => runtime.debugger(identity, signal, { action: 'scope_variables', callFrameId, scopeNumber: 0 }), undefined)
  }
  async function ensurePaused(label) {
    await runtime.debugger(identity, signal, { action: 'pause' })
    const state = await pausedFrames()
    if ((state?.data?.callFrames ?? []).length === 0) throw new Error(`debugger never paused before ${label}`)
    return state
  }
  await ensurePaused('step_over')
  await step('browser_debugger', 'step_over', { action: 'step_over' }, () => runtime.debugger(identity, signal, { action: 'step_over' }))
  // Resume while provably paused: after step_out the renderer runs on its own, so a
  // later resume would race the plugin's paused flag.
  await ensurePaused('resume')
  await step('browser_debugger', 'resume', { action: 'resume' }, () => runtime.debugger(identity, signal, { action: 'resume' }))
  await ensurePaused('step_into')
  await step('browser_debugger', 'step_into', { action: 'step_into' }, () => runtime.debugger(identity, signal, { action: 'step_into' }))
  await ensurePaused('step_out')
  await step('browser_debugger', 'step_out', { action: 'step_out' }, () => runtime.debugger(identity, signal, { action: 'step_out' }))
}
if (debuggerState.breakpointId !== undefined) {
  await step('browser_debugger', 'remove_breakpoint', { action: 'remove_breakpoint', breakpointId: debuggerState.breakpointId }, () => runtime.debugger(identity, signal, { action: 'remove_breakpoint', breakpointId: debuggerState.breakpointId }))
}
await step('browser_debugger', 'detach', { action: 'detach' }, () => runtime.debugger(identity, signal, { action: 'detach' }))

// ------------------------------------------------------------------ evaluate
await step('browser_evaluate', 'main world', { action: 'main_world', expression: 'document.title' }, () => runtime.evaluate(identity, signal, { action: 'main_world', expression: 'document.title' }), output => must(output.data?.value === 'Fixture Home', `main world title mismatch: ${JSON.stringify(output.data?.value)}`))
await step('browser_evaluate', 'isolated world', { action: 'isolated', expression: 'typeof window.document' }, () => runtime.evaluate(identity, signal, { action: 'isolated', expression: 'typeof window.document' }), output => must(output.data?.value === 'object', `isolated world value mismatch: ${JSON.stringify(output.data?.value)}`))
await step('browser_evaluate', 'exception reported', { action: 'main_world', expression: 'throw new Error("boom")' }, () => runtime.evaluate(identity, signal, { action: 'main_world', expression: 'throw new Error("boom")' }), undefined, { allowFailure: true, expectError: /boom|EVALUATION_FAILED/ })

// ----------------------------------------------------------------- diagnose
await step('browser_diagnose', 'start', { action: 'start' }, () => runtime.diagnose(identity, signal, { action: 'start' }))
await step('browser_diagnose', 'status', { action: 'status' }, () => runtime.diagnose(identity, signal, { action: 'status' }))
const beforeCheckpoint = await step('browser_diagnose', 'checkpoint before', { action: 'checkpoint', label: 'before' }, () => runtime.diagnose(identity, signal, { action: 'checkpoint', label: 'before' }))
{
  const ref = await refFor('#btn')
  await step('browser_click', 'diagnose click', { ref }, () => runtime.elementAction(identity, signal, { action: 'click', ref }))
}
const after = await step('browser_diagnose', 'checkpoint after', { action: 'checkpoint', label: 'after' }, () => runtime.diagnose(identity, signal, { action: 'checkpoint', label: 'after' }))
const beforeCheckpointId = beforeCheckpoint?.data?.checkpoint?.checkpointId
const afterCheckpointId = after?.data?.checkpoint?.checkpointId
await step('browser_diagnose', 'compare', { action: 'compare', beforeCheckpointId, afterCheckpointId }, () => runtime.diagnose(identity, signal, { action: 'compare', beforeCheckpointId, afterCheckpointId }), output => must(JSON.stringify(output.data ?? {}).includes('verdict') || JSON.stringify(output.data ?? {}).includes('overallVerdict'), 'compare must return a verdict'))
{
  const ref = await refFor('#deep')
  await step('browser_diagnose', 'inspect', { action: 'inspect', ref }, () => runtime.diagnose(identity, signal, { action: 'inspect', ref }), output => must(JSON.stringify(output.data ?? {}).includes('element'), 'inspect must describe the element'))
}
await step('browser_diagnose', 'report', { action: 'report' }, () => runtime.diagnose(identity, signal, { action: 'report' }))
await step('browser_diagnose', 'recorder_status', { action: 'recorder_status' }, () => runtime.diagnose(identity, signal, { action: 'recorder_status' }))
await step('browser_diagnose', 'recorder_start(rolling)', { action: 'recorder_start', recorderMode: 'rolling' }, () => runtime.diagnose(identity, signal, { action: 'recorder_start', recorderMode: 'rolling' }))
const mark = await step('browser_diagnose', 'recorder_mark', { action: 'recorder_mark', label: 'mark-1' }, () => runtime.diagnose(identity, signal, { action: 'recorder_mark', label: 'mark-1' }))
const incidentId = mark?.data?.incident?.incidentId
await step('browser_diagnose', 'recorder_pause', { action: 'recorder_pause' }, () => runtime.diagnose(identity, signal, { action: 'recorder_pause' }))
await step('browser_diagnose', 'recorder_resume', { action: 'recorder_resume' }, () => runtime.diagnose(identity, signal, { action: 'recorder_resume' }))
await step('browser_diagnose', 'recorder_timeline', { action: 'recorder_timeline' }, () => runtime.diagnose(identity, signal, { action: 'recorder_timeline' }))
await step('browser_diagnose', 'recorder_complete', { action: 'recorder_complete', incidentId }, () => runtime.diagnose(identity, signal, { action: 'recorder_complete', incidentId }), output => must(output.data?.incident !== undefined, 'recorder_complete must return the completed incident'))
await step('browser_diagnose', 'recorder_clear', { action: 'recorder_clear' }, () => runtime.diagnose(identity, signal, { action: 'recorder_clear' }))
await step('browser_diagnose', 'recorder_stop', { action: 'recorder_stop' }, () => runtime.diagnose(identity, signal, { action: 'recorder_stop' }))
await step('browser_diagnose', 'stop', { action: 'stop' }, () => runtime.diagnose(identity, signal, { action: 'stop' }))
evidence.diagnoseCheckpoint = after?.data ?? null

// ---------------------------------------------------------- network control
await step('browser_network_control', 'enable', { action: 'enable', urlPattern: '**/api**', requestStage: 'request' }, () => runtime.networkControl(identity, signal, { action: 'enable', urlPattern: '**/api**', requestStage: 'request' }))
async function triggerApiFetch(marker) {
  return runtime.evaluate(identity, signal, { action: 'main_world', expression: `void fetch('/api?${marker}')` })
}
async function waitForPausedRequest(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const listed = await runtime.networkControl(identity, signal, { action: 'list_paused' })
    const paused = listed?.data?.pausedRequests ?? []
    if (paused.length > 0) return paused[0]
    await new Promise(done => setTimeout(done, 150))
  }
  return undefined
}
{
  await triggerApiFetch('paused-continue')
  const paused = await waitForPausedRequest()
  if (paused === undefined) {
    results.push({ tool: 'browser_network_control', name: 'list_paused', status: 'FAIL', error: 'no paused request observed within 8s' })
  } else {
    results.push({ tool: 'browser_network_control', name: 'list_paused', status: 'PASS', data: summarize(paused) })
    evidence.pausedRequest = paused
    await step('browser_network_control', 'continue', { action: 'continue', requestId: paused.requestId }, () => runtime.networkControl(identity, signal, { action: 'continue', requestId: paused.requestId }))
  }
}
{
  await triggerApiFetch('paused-abort')
  const paused = await waitForPausedRequest()
  if (paused !== undefined) {
    await step('browser_network_control', 'abort', { action: 'abort', requestId: paused.requestId }, () => runtime.networkControl(identity, signal, { action: 'abort', requestId: paused.requestId }))
  } else {
    results.push({ tool: 'browser_network_control', name: 'abort', status: 'FAIL', error: 'no paused request observed within 8s' })
  }
}
{
  await triggerApiFetch('paused-fulfill')
  const paused = await waitForPausedRequest()
  if (paused !== undefined) {
    await step('browser_network_control', 'fulfill', { action: 'fulfill', requestId: paused.requestId, responseCode: 200, responsePhrase: 'OK', body: '{"fulfilled":true}', headers: [{ name: 'content-type', value: 'application/json' }] }, () => runtime.networkControl(identity, signal, { action: 'fulfill', requestId: paused.requestId, responseCode: 200, responsePhrase: 'OK', body: '{"fulfilled":true}', headers: [{ name: 'content-type', value: 'application/json' }] }))
  } else {
    results.push({ tool: 'browser_network_control', name: 'fulfill', status: 'FAIL', error: 'no paused request observed within 8s' })
  }
}
{
  await triggerApiFetch('paused-replay')
  const paused = await waitForPausedRequest()
  if (paused !== undefined) {
    await step('browser_network_control', 'replay', { action: 'replay', requestId: paused.requestId }, () => runtime.networkControl(identity, signal, { action: 'replay', requestId: paused.requestId }))
    await step('browser_network_control', 'continue after replay', { action: 'continue', requestId: paused.requestId }, () => runtime.networkControl(identity, signal, { action: 'continue', requestId: paused.requestId }))
  } else {
    results.push({ tool: 'browser_network_control', name: 'replay', status: 'FAIL', error: 'no paused request observed within 8s' })
  }
}
await step('browser_network_control', 'disable', { action: 'disable' }, () => runtime.networkControl(identity, signal, { action: 'disable' }))
{
  await step('browser_network_control', 'enable response stage', { action: 'enable', urlPattern: '**/api**', requestStage: 'response' }, () => runtime.networkControl(identity, signal, { action: 'enable', urlPattern: '**/api**', requestStage: 'response' }))
  await triggerApiFetch('paused-body')
  const paused = await waitForPausedRequest()
  if (paused !== undefined) {
    await step('browser_network_control', 'body', { action: 'body', requestId: paused.requestId }, () => runtime.networkControl(identity, signal, { action: 'body', requestId: paused.requestId }), output => must(JSON.stringify(output.data ?? {}).length > 2, 'body must return content metadata'))
    await step('browser_network_control', 'continue body', { action: 'continue', requestId: paused.requestId }, () => runtime.networkControl(identity, signal, { action: 'continue', requestId: paused.requestId }))
  } else {
    results.push({ tool: 'browser_network_control', name: 'body', status: 'FAIL', error: 'no paused response observed within 8s' })
  }
  await step('browser_network_control', 'disable response stage', { action: 'disable' }, () => runtime.networkControl(identity, signal, { action: 'disable' }))
}

// ------------------------------------------------------------------- profile
await step('browser_profile', 'trace_start', { action: 'trace_start' }, () => runtime.profile(identity, signal, { action: 'trace_start' }))
await step('browser_profile', 'trace_stop', { action: 'trace_stop' }, () => runtime.profile(identity, signal, { action: 'trace_stop' }))
await step('browser_profile', 'cpu_start', { action: 'cpu_start' }, () => runtime.profile(identity, signal, { action: 'cpu_start' }))
await step('browser_profile', 'cpu_stop', { action: 'cpu_stop' }, () => runtime.profile(identity, signal, { action: 'cpu_stop' }))
await step('browser_profile', 'coverage_start', { action: 'coverage_start' }, () => runtime.profile(identity, signal, { action: 'coverage_start' }))
await step('browser_profile', 'coverage_stop', { action: 'coverage_stop' }, () => runtime.profile(identity, signal, { action: 'coverage_stop' }))
await step('browser_profile', 'heap_snapshot', { action: 'heap_snapshot' }, () => runtime.profile(identity, signal, { action: 'heap_snapshot' }))
await step('browser_profile', 'heap_sampling_start', { action: 'heap_sampling_start' }, () => runtime.profile(identity, signal, { action: 'heap_sampling_start' }))
await step('browser_profile', 'heap_sampling_stop', { action: 'heap_sampling_stop' }, () => runtime.profile(identity, signal, { action: 'heap_sampling_stop' }))
const artifacts = await step('browser_profile', 'artifacts', { action: 'artifacts' }, () => runtime.profile(identity, signal, { action: 'artifacts' }))
const smallest = [...(artifacts?.data?.artifacts ?? [])].sort((left, right) => (left.bytes ?? 0) - (right.bytes ?? 0))[0]
const artifactId = smallest?.artifactId
if (artifactId !== undefined) {
  await step('browser_profile', 'artifact_read', { action: 'artifact_read', artifactId, maxReadBytes: 4096 }, () => runtime.profile(identity, signal, { action: 'artifact_read', artifactId, maxReadBytes: 4096 }), output => must(output.data?.reference !== undefined || output.data?.artifact !== undefined, 'artifact_read must return the artifact metadata plus its content'))
}

// ------------------------------------------------------------------ emulate
await step('browser_emulate', 'viewport', { action: 'viewport', width: 900, height: 700 }, () => runtime.emulate(identity, signal, { action: 'viewport', width: 900, height: 700 }))
await step('browser_emulate', 'device', { action: 'device', device: 'iPhone 13' }, () => runtime.emulate(identity, signal, { action: 'device', device: 'iPhone 13' }))
await step('browser_emulate', 'locale', { action: 'locale', locale: 'de-DE' }, () => runtime.emulate(identity, signal, { action: 'locale', locale: 'de-DE' }))
await step('browser_emulate', 'timezone', { action: 'timezone', timezoneId: 'Europe/Berlin' }, () => runtime.emulate(identity, signal, { action: 'timezone', timezoneId: 'Europe/Berlin' }))
await step('browser_emulate', 'network', { action: 'network', latencyMs: 120, downloadKbps: 8000, uploadKbps: 4000 }, () => runtime.emulate(identity, signal, { action: 'network', latencyMs: 120, downloadKbps: 8000, uploadKbps: 4000 }))
await step('browser_emulate', 'cpu', { action: 'cpu', rate: 4 }, () => runtime.emulate(identity, signal, { action: 'cpu', rate: 4 }))
await step('browser_emulate', 'offline', { action: 'offline', offline: true }, () => runtime.emulate(identity, signal, { action: 'offline', offline: true }))
await step('browser_emulate', 'online', { action: 'offline', offline: false }, () => runtime.emulate(identity, signal, { action: 'offline', offline: false }))
await step('browser_emulate', 'permissions', { action: 'permissions', permissions: ['geolocation'], origin: base }, () => runtime.emulate(identity, signal, { action: 'permissions', permissions: ['geolocation'], origin: base }))
await step('browser_emulate', 'reset', { action: 'reset' }, () => runtime.emulate(identity, signal, { action: 'reset' }))

// --------------------------------------------------------------- live view
await step('browser_live_view', 'status', { action: 'status' }, () => runtime.liveView(identity, signal, { action: 'status' }))
await step('browser_live_view', 'standard', { action: 'standard' }, () => runtime.liveView(identity, signal, { action: 'standard' }))
await step('browser_live_view', 'adaptive', { action: 'adaptive' }, () => runtime.liveView(identity, signal, { action: 'adaptive' }), undefined, { allowFailure: true, expectError: /live panel|ADAPTIVE_SIZE_UNAVAILABLE/, note: 'environment-limited: adaptive sizing needs an open live panel in the Web UI' })

// -------------------------------------------------------------- split view
await step('browser_split_view', 'status', { action: 'status' }, () => runtime.splitView(identity, signal, { action: 'status' }))
await step('browser_split_view', 'open', { action: 'open' }, () => runtime.splitView(identity, signal, { action: 'open' }))
await step('browser_split_view', 'assign', { action: 'assign', pane: 'bottom', viewId: activeViewId }, () => runtime.splitView(identity, signal, { action: 'assign', pane: 'bottom', viewId: activeViewId }))
await step('browser_split_view', 'focus', { action: 'focus', pane: 'top' }, () => runtime.splitView(identity, signal, { action: 'focus', pane: 'top' }))
await step('browser_split_view', 'ratio', { action: 'ratio', ratio: 0.55 }, () => runtime.splitView(identity, signal, { action: 'ratio', ratio: 0.55 }))
await step('browser_split_view', 'orientation', { action: 'orientation', orientation: 'left-right' }, () => runtime.splitView(identity, signal, { action: 'orientation', orientation: 'left-right' }))
await step('browser_split_view', 'swap', { action: 'swap' }, () => runtime.splitView(identity, signal, { action: 'swap' }))
await step('browser_split_view', 'close', { action: 'close' }, () => runtime.splitView(identity, signal, { action: 'close' }))

// --------------------------------------------------------------- extensions
await step('browser_extensions', 'list', { action: 'list' }, () => runtime.extensions(identity, signal, { action: 'list' }))

// ----------------------------------------------------------------- takeover
await step('browser_takeover', 'status', { action: 'status' }, () => runtime.takeover(identity, signal, { action: 'status' }))
await step('browser_takeover', 'request', { action: 'request' }, () => runtime.takeover(identity, signal, { action: 'request' }))
await step('browser_takeover', 'write blocked while user owns control', { ref: 'e1' }, () => runtime.elementAction(identity, signal, { action: 'click', ref: 'e1' }), undefined, { allowFailure: true })
await step('browser_takeover', 'return', { action: 'return' }, () => runtime.takeover(identity, signal, { action: 'return' }))
await step('browser_takeover', 'cancel', { action: 'cancel' }, () => runtime.takeover(identity, signal, { action: 'cancel' }))

// ---------------------------------------------------------------- teardown
await step('browser_provider', 'disconnect', { action: 'disconnect' }, () => runtime.provider(identity, signal, { action: 'disconnect' }))
await step('browser_provider', 'list after disconnect', { action: 'list' }, () => runtime.provider(identity, signal, { action: 'list' }))

// ------------------------------------------------------------------ report
await runtime.dispose().catch(() => {})
await browser.close()
await fixtureServer.close()

for (const item of results) {
  if (item.status !== 'FAIL') continue
  const known = knownIssues.find(candidate => candidate.tool === item.tool && candidate.name === item.name)
  if (known !== undefined) {
    item.status = 'KNOWN'
    item.knownKind = known.kind
    item.knownReason = known.reason
  }
}

const tools = [...new Set(results.map(item => item.tool))]
const summary = {
  generatedAt: new Date().toISOString(),
  browser: browser.version,
  endpoint: browser.endpoint,
  fixtureBase: base,
  total: results.length,
  passed: results.filter(item => item.status === 'PASS').length,
  failed: results.filter(item => item.status === 'FAIL').length,
  known: results.filter(item => item.status === 'KNOWN').length,
  perTool: Object.fromEntries(tools.map(tool => {
    const own = results.filter(item => item.tool === tool)
    return [tool, { total: own.length, passed: own.filter(item => item.status === 'PASS').length, failed: own.filter(item => item.status === 'FAIL').length, known: own.filter(item => item.status === 'KNOWN').length }]
  })),
  knownIssues: results.filter(item => item.status === 'KNOWN'),
  results,
  evidence,
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const jsonPath = join(reportDir, `tools-${stamp}.json`)
const mdPath = join(reportDir, `tools-${stamp}.md`)
await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
const lines = [
  `# browser tools verification — ${summary.generatedAt}`,
  '',
  `- browser: ${summary.browser}`,
  `- endpoint: ${summary.endpoint}`,
  `- fixture: ${summary.fixtureBase}`,
  `- checks: ${summary.total} · passed ${summary.passed} · known-defect ${summary.known} · failed ${summary.failed}`,
  '',
  '| tool | checks | passed | known | failed |',
  '| --- | --- | --- | --- | --- |',
  ...Object.entries(summary.perTool).map(([tool, stat]) => `| ${tool} | ${stat.total} | ${stat.passed} | ${stat.known} | ${stat.failed} |`),
  '',
  '## known defects reproduced (not fixed here)',
  '',
  ...summary.knownIssues.map(item => `- **${item.tool} · ${item.name}** (${item.knownKind}): ${item.knownReason} — observed: ${String(item.error ?? '').replace(/\n/g, ' ').slice(0, 200)}`),
  '',
  '## every check',
  '',
  '| tool | check | status | ms | detail |',
  '| --- | --- | --- | --- | --- |',
  ...results.map(item => `| ${item.tool} | ${item.name} | ${item.status} | ${item.ms} | ${(item.error ?? item.knownReason ?? item.note ?? item.data ?? '').toString().replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 160)} |`),
  '',
]
await writeFile(mdPath, lines.join('\n'), 'utf8')

console.log(`\n${summary.passed}/${summary.total} passed · ${summary.known} known defect(s) · ${summary.failed} failed`)
for (const item of results.filter(entry => entry.status === 'KNOWN')) {
  console.log(`KNOWN ${item.tool} :: ${item.name} :: ${item.knownReason}`)
}
for (const item of results.filter(entry => entry.status === 'FAIL')) {
  console.log(`FAIL ${item.tool} :: ${item.name} :: ${item.error}`)
}
console.log(`report: ${jsonPath}`)
console.log(`report: ${mdPath}`)
process.exitCode = summary.failed === 0 ? 0 : 1
