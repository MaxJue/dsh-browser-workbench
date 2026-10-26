import assert from 'node:assert/strict'
import test from 'node:test'
import { bindBrowserSafetyPolicy } from '../../src/application/security-policy.ts'

const DEFINITIONS = [
  'browser_navigate',
  'browser_navigate_back',
  'browser_snapshot',
  'browser_query',
  'browser_get_attribute',
  'browser_console_messages',
  'browser_network_requests',
  'browser_wait_for',
  'browser_take_screenshot',
  'browser_click',
  'browser_hover',
  'browser_scroll',
  'browser_handle_dialog',
  'browser_evaluate',
  'browser_debugger',
  'browser_extensions',
  'browser_tabs',
].map(name => ({ name }))

function harness(options = {}) {
  const handlers = new Map()
  const ctx = {
    effect(create) {
      create()
    },
    on(event, handler) {
      handlers.set(event, handler)
    },
    agents: { get: () => undefined },
    permissionPresets: { current: () => options.preset ?? 'standard' },
  }
  const config = {
    definitions: DEFINITIONS,
    getController: () => options.controller,
    getEffectiveToolRegistrationMode: () => options.mode ?? 'global',
    subagentInteractive: options.subagentInteractive ?? false,
  }
  bindBrowserSafetyPolicy(ctx, { dispose: async () => {} }, config)
  const preExecute = handlers.get('tools/pre-execute')
  assert.equal(typeof preExecute, 'function')
  return async (name, args, { origin = 'chat', preset = options.preset, sessionId = 's1' } = {}) => {
    if (preset !== undefined) ctx.permissionPresets.current = () => preset
    let nextCalled = false
    const result = await preExecute(
      { name, arguments: args, agent: { session: { id: sessionId, header: { origin, createdAt: 1 } } } },
      async () => {
        nextCalled = true
        return { kind: 'next' }
      },
    )
    return { result, nextCalled }
  }
}

test('unowned tools fall through to the next policy', async () => {
  const run = harness()
  const { result, nextCalled } = await run('other_tool', {}, { origin: 'subagent' })
  assert.deepEqual(result, { kind: 'next' })
  assert.equal(nextCalled, true)
})

test('session-select mode only owns tools the controller selected', async () => {
  const run = harness({ mode: 'session-select', controller: { ownsExecution: () => false } })
  const { nextCalled } = await run('browser_click', {}, { origin: 'subagent' })
  assert.equal(nextCalled, true)
})

test('subagent interactions are denied when subagentInteractive is false', async () => {
  const run = harness({ subagentInteractive: false })
  for (const [name, args] of [
    ['browser_click', {}],
    ['browser_navigate', { url: 'https://example.com' }],
    ['browser_navigate_back', {}],
    ['browser_hover', { ref: 'e1' }],
    ['browser_scroll', { direction: 'down' }],
    ['browser_handle_dialog', { action: 'accept' }],
    ['browser_tabs', { action: 'new', url: 'https://example.com' }],
  ]) {
    const { result } = await run(name, args, { origin: 'subagent' })
    assert.deepEqual(result, { kind: 'deny', reason: `delegated browser session cannot use ${name}` })
  }
  const { result: evaluate } = await run('browser_evaluate', { action: 'main_world', expression: '1' }, { origin: 'subagent' })
  assert.equal(evaluate.kind, 'deny')
})

test('subagent read-only tools stay allowed', async () => {
  const run = harness({ subagentInteractive: false })
  for (const name of ['browser_snapshot', 'browser_query', 'browser_get_attribute', 'browser_console_messages', 'browser_network_requests', 'browser_wait_for', 'browser_take_screenshot']) {
    const { result } = await run(name, {}, { origin: 'subagent' })
    assert.deepEqual(result, { kind: 'allow' }, `${name} must stay readable for subagents`)
  }
  const { result: blankTab } = await run('browser_tabs', { action: 'new' }, { origin: 'subagent' })
  assert.deepEqual(blankTab, { kind: 'allow' })
})

test('subagentInteractive lets a subagent drive interactions', async () => {
  const run = harness({ subagentInteractive: true })
  const { result } = await run('browser_click', {}, { origin: 'subagent' })
  assert.deepEqual(result, { kind: 'allow' })
  const { result: navigate } = await run('browser_navigate', { url: 'https://example.com' }, { origin: 'subagent', preset: 'standard' })
  assert.deepEqual(navigate, { kind: 'allow' })
  const { result: debuggerPause } = await run('browser_debugger', { action: 'pause' }, { origin: 'subagent', preset: 'standard' })
  assert.deepEqual(debuggerPause, { kind: 'allow' })
})

test('top-level mutations ask under a normal preset and pass under full access', async () => {
  const run = harness({ subagentInteractive: false })
  const { result: ask } = await run('browser_navigate', { url: 'https://example.com' }, { preset: 'standard' })
  assert.deepEqual(ask, { kind: 'ask', reason: 'browser_navigate changes browser or host state' })
  const { result: allow } = await run('browser_navigate', { url: 'https://example.com' }, { preset: 'danger-full-access' })
  assert.deepEqual(allow, { kind: 'allow' })
  const { result: read } = await run('browser_snapshot', {}, { preset: 'standard' })
  assert.deepEqual(read, { kind: 'allow' })
})

test('extension mutations describe the target and apply mode', async () => {
  const run = harness()
  const { result } = await run('browser_extensions', { action: 'install', extension: '/tmp/ext', applyMode: 'now' }, { preset: 'standard' })
  assert.deepEqual(result, {
    kind: 'ask',
    reason: 'browser_extensions install targets /tmp/ext and will immediately rebuild the browser',
  })
})

test('tab navigation to a real URL is treated like navigate', async () => {
  const run = harness()
  const { result: blank } = await run('browser_tabs', { action: 'new' }, { preset: 'standard' })
  assert.deepEqual(blank, { kind: 'allow' })
  const { result: url } = await run('browser_tabs', { action: 'new', url: 'https://example.com' }, { preset: 'standard' })
  assert.deepEqual(url, { kind: 'ask', reason: 'browser_tabs changes browser or host state' })
})
