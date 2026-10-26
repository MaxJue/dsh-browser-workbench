import assert from 'node:assert/strict'
import test from 'node:test'
import { handlePageClose } from '../../src/page/page-close-events.ts'

function dependencies(events) {
  return {
    releaseViewRefs: async view => events.push(['release', view.viewId]),
    removeContextIdentity: (sessionKey, viewId) => events.push(['identity', sessionKey, viewId]),
    deactivateView: (sessionKey, viewId) => events.push(['deactivate', sessionKey, viewId]),
    invalidateDebugger: (sessionKey, viewId) => events.push(['debugger', sessionKey, viewId]),
    splitPaneForView: () => undefined,
    splitPaneView: () => undefined,
    applyLiveViewport: async (session, view) => events.push(['viewport', session, view.viewId]),
    queueSession: async (session, operation) => { events.push(['queue', session]); await operation() },
    syncScreencasts: async session => events.push(['screencasts', session]),
  }
}

test('extension popup close removes popup state and releases view resources', async () => {
  const events = []
  const view = { viewId: 'popup', kind: 'extension-popup', page: { isClosed: () => true } }
  const session = {
    key: 'session@1',
    views: new Map([['popup', view]]),
    extensionPopup: { view },
    splitView: { enabled: false },
  }

  handlePageClose(session, view, dependencies(events))
  await Promise.resolve()

  assert.equal(session.views.has('popup'), false)
  assert.equal(session.extensionPopup, undefined)
  assert.deepEqual(events.slice(0, 4), [
    ['release', 'popup'],
    ['identity', 'session@1', 'popup'],
    ['deactivate', 'session@1', 'popup'],
    ['debugger', 'session@1', 'popup'],
  ])
})

test('active page close selects the next page and synchronizes screencasts', async () => {
  const events = []
  const closed = { viewId: 'v1', kind: 'page', page: { isClosed: () => true } }
  const next = { viewId: 'v2', kind: 'page', page: { isClosed: () => false, bringToFront: async () => {} } }
  const session = {
    key: 'session@1',
    activeViewId: 'v1',
    views: new Map([['v1', closed], ['v2', next]]),
    splitView: { enabled: false, topViewId: undefined, bottomViewId: undefined, changedAt: 0 },
  }

  handlePageClose(session, closed, dependencies(events))
  await Promise.resolve()

  assert.equal(session.activeViewId, 'v2')
  assert.equal(events.some(event => event[0] === 'viewport' && event[2] === 'v2'), true)
  assert.equal(events.some(event => event[0] === 'screencasts'), true)
})

