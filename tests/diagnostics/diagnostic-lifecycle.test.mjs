import assert from 'node:assert/strict'
import test from 'node:test'
import { diagnosticLifecycleAction } from '../../src/diagnostics/diagnostic-lifecycle.ts'

function setup() {
  const calls = []
  const view = {
    viewId: 'view-1',
    documentGeneration: 3,
    navigationId: 'view-1-n3',
    page: { isClosed: () => false },
    cdp: { contextAdapter: { isEnabled: () => false, dispose: () => calls.push(['dispose']), snapshot: () => ({}) } },
  }
  const session = {
    key: 'session-1',
    sessionId: 'session-raw',
    contextGeneration: 7,
    activeViewId: 'view-1',
    views: new Map([['view-1', view]]),
    diagnosticPanel: {},
  }
  let stored
  const debugSessions = {
    get: () => stored,
    start: input => { stored = { ...input, debugSessionId: 'debug-1', checkpoints: new Map(), status: 'active' }; return stored },
    require: () => stored,
    invalidate: () => { calls.push(['invalidate']); stored = undefined },
    stop: () => { const previous = stored; stored = undefined; return previous },
  }
  const contextIdentities = { invalidateSession: (...args) => calls.push(['invalidate-identities', ...args]) }
  const dependencies = {
    session,
    debugSessions,
    contextIdentities,
    view: () => view,
    ensureContextIdentity: async () => view.cdp,
    refreshApplications: async () => [{ applicationId: 'app-1' }],
    diagnosticContext: () => ({ debugSessionId: 'debug-1' }),
    checkpointCursor: () => 12,
    buildTopology: () => ({ builds: [] }),
    applicationTopology: () => ({ truncated: false }),
    journalCursor: () => ({ sequence: 12 }),
  }
  return { calls, view, session, debugSessions, dependencies }
}

test('start binds a diagnostic session to the current view and clears old panel projections', async () => {
  const { session, dependencies } = setup()
  session.diagnosticPanel.latestInspect = { stale: true }
  session.diagnosticPanel.latestComparison = { stale: true }
  session.diagnosticPanel.latestIncident = { stale: true }

  const result = await diagnosticLifecycleAction({ ...dependencies, input: { action: 'start' } })

  assert.equal(result.action, 'diagnose_start')
  assert.equal(result.data.startedCursor, 12)
  assert.equal(result.data.applicationTopology.applications[0].applicationId, 'app-1')
  assert.equal(session.diagnosticPanel.latestInspect, undefined)
  assert.equal(dependencies.debugSessions.get().viewId, 'view-1')
})

test('status invalidates sessions whose context generation is stale', async () => {
  const { calls, dependencies, debugSessions, session } = setup()
  await diagnosticLifecycleAction({ ...dependencies, input: { action: 'start' } })
  debugSessions.get().contextGeneration = 6

  const result = await diagnosticLifecycleAction({ ...dependencies, input: { action: 'status' } })

  assert.deepEqual(result.data, { active: false, schemaVersion: 2, previousDebugSessionId: 'debug-1', status: 'invalidated' })
  assert.deepEqual(calls, [['invalidate']])
  assert.equal(session.activeViewId, 'view-1')
})

test('stop disposes context identity and reports deterministic cleanup status', async () => {
  const { calls, dependencies } = setup()
  await diagnosticLifecycleAction({ ...dependencies, input: { action: 'start' } })

  const result = await diagnosticLifecycleAction({ ...dependencies, input: { action: 'stop' } })

  assert.equal(result.action, 'diagnose_stop')
  assert.equal(result.data.cleanup.status, 'clean')
  assert.equal(result.data.cursor.sequence, 12)
  assert.deepEqual(calls, [['dispose'], ['invalidate-identities', 'session-1', 7]])
})

test('non-lifecycle actions are left to the diagnostic workflow', async () => {
  const { dependencies } = setup()
  assert.equal(await diagnosticLifecycleAction({ ...dependencies, input: { action: 'report' } }), undefined)
})
