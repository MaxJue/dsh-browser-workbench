import assert from 'node:assert/strict'
import test from 'node:test'
import {
  debuggerPauseResponse,
  resolveRef,
  resolveView,
  resolveViewByInput,
  staleReferenceResponse,
  userTakeoverResponse,
} from '../../src/view/view-access.ts'

function makeView(viewId, { kind = 'page', closed = false, paused = false } = {}) {
  return {
    viewId,
    kind,
    page: { isClosed: () => closed },
    cdp: { paused },
  }
}

test('resolveRef rejects refs from an older document or snapshot', () => {
  const handle = {}
  const view = { refs: new Map([['fresh', { handle, documentGeneration: 2, snapshotGeneration: 3 }]]), documentGeneration: 2, snapshotGeneration: 3 }
  assert.equal(resolveRef(view, 'fresh'), handle)
  view.snapshotGeneration = 4
  assert.throws(() => resolveRef(view, 'fresh'), error => error.code === 'STALE_REF')
})

function makeSession(views, activeViewId = 'first', owner = 'model') {
  return { views: new Map(views.map(view => [view.viewId, view])), activeViewId, control: { owner } }
}

test('resolves the active view by default and normalizes blank ids', () => {
  const first = makeView('first')
  const second = makeView('second')
  const session = makeSession([first, second])

  assert.equal(resolveView(session), first)
  assert.equal(resolveView(session, '  '), first)
  assert.equal(resolveView(session, ' second '), second)
  assert.equal(session.activeViewId, 'second')
})

test('resolves page indexes without counting extension popups', () => {
  const first = makeView('first')
  const popup = makeView('popup', { kind: 'extension-popup' })
  const second = makeView('second')
  const session = makeSession([first, popup, second])

  assert.equal(resolveViewByInput(session, undefined, 1), second)
  assert.equal(session.activeViewId, 'second')
  assert.throws(() => resolveViewByInput(session, undefined, 2), /browser tab index 2 does not exist/)
})

test('rejects missing and closed views', () => {
  const closed = makeView('closed', { closed: true })
  const session = makeSession([closed], 'closed')

  assert.throws(() => resolveView(session, 'missing'), /browser view "missing" does not exist/)
  assert.throws(() => resolveView(session), /browser view "closed" does not exist/)
})

test('returns debugger and takeover blockers with actionable next steps', () => {
  const view = makeView('tab-1', { paused: true })
  const session = makeSession([view], 'tab-1', 'user')

  assert.deepEqual(debuggerPauseResponse(view, 'click'), {
    ok: false,
    action: 'click',
    viewId: 'tab-1',
    data: {
      code: 'DEBUGGER_PAUSED',
      recoverable: true,
      message: 'The page is paused in the JavaScript debugger.',
      next: { tool: 'browser_debugger', arguments: { action: 'resume', viewId: 'tab-1' } },
    },
  })
  assert.equal(debuggerPauseResponse(makeView('ready'), 'click'), undefined)
  assert.equal(userTakeoverResponse(makeSession([view]), view, 'click'), undefined)
  assert.deepEqual(userTakeoverResponse(session, view, 'click').data.next, {
    tool: 'browser_takeover', arguments: { action: 'status', viewId: 'tab-1' },
  })
})

test('stale references request a fresh snapshot diff', () => {
  const response = staleReferenceResponse(makeView('tab-2'), 'click')
  assert.equal(response.data.code, 'STALE_REF')
  assert.deepEqual(response.data.next, {
    tool: 'browser_snapshot', arguments: { viewId: 'tab-2', includeDiff: true },
  })
})

