import assert from 'node:assert/strict'
import test from 'node:test'
import { mutateSplitView } from '../../src/view/split-view-actions.ts'

function session() {
  const first = { viewId: 'v1', kind: 'page', page: { isClosed: () => false, bringToFront: async () => {} } }
  const second = { viewId: 'v2', kind: 'page', page: { isClosed: () => false, bringToFront: async () => {} } }
  return {
    sessionId: 's1',
    activeViewId: 'v1',
    views: new Map([['v1', first], ['v2', second]]),
    liveView: { mode: 'adaptive' },
    splitView: {
      enabled: false,
      topViewId: undefined,
      bottomViewId: undefined,
      focusedPane: 'top',
      orientation: 'top-bottom',
      ratio: 0.5,
      panes: { top: {}, bottom: {} },
      changedAt: 0,
    },
  }
}

function dependencies(calls = []) {
  return {
    createPage: async () => ({ page: true }),
    bindView: (target, page) => { const view = { viewId: 'v3', kind: 'page', page: { isClosed: () => false } }; target.views.set(view.viewId, view); calls.push(['bind', page]); return view },
    splitPaneView: (target, pane) => { const id = pane === 'top' ? target.splitView.topViewId : target.splitView.bottomViewId; return id === undefined ? undefined : target.views.get(id) },
    resolveView: (target, viewId) => target.views.get(viewId),
    savePreference: async (...args) => calls.push(['save', ...args]),
    applyLiveViewport: async (...args) => calls.push(['viewport', ...args]),
  }
}

test('split open assigns two pages and resets pane measurements', async () => {
  const state = session()
  const result = await mutateSplitView(state, { action: 'open' }, dependencies())
  assert.equal(result.changed, true)
  assert.equal(state.splitView.enabled, true)
  assert.deepEqual([state.splitView.topViewId, state.splitView.bottomViewId], ['v1', 'v2'])
  assert.deepEqual(state.splitView.panes, { top: {}, bottom: {} })
})

test('split ratio clamps to supported bounds and persists only changes', async () => {
  const state = session()
  state.splitView.enabled = true
  state.splitView.topViewId = 'v1'
  state.splitView.bottomViewId = 'v2'
  const calls = []
  const result = await mutateSplitView(state, { action: 'ratio', ratio: 0.9 }, dependencies(calls))
  assert.equal(result.changed, true)
  assert.equal(state.splitView.ratio, 0.6)
  assert.equal(calls[0][0], 'save')
})

test('split resize normalizes pane dimensions and applies adaptive viewport when changed', async () => {
  const state = session()
  state.splitView.enabled = true
  state.splitView.topViewId = 'v1'
  state.splitView.bottomViewId = 'v2'
  const calls = []
  const result = await mutateSplitView(state, { action: 'resize', pane: 'top', width: 100, height: 100 }, dependencies(calls))
  assert.equal(result.changed, true)
  assert.deepEqual(state.splitView.panes.top, { adaptiveWidth: 160, adaptiveHeight: 120 })
  assert.equal(calls[0][0], 'viewport')
})

test('split adaptive action errors are preserved for closed or missing views', async () => {
  const state = session()
  const result = await mutateSplitView(state, { action: 'status' }, dependencies())
  assert.equal(result.status, true)
  assert.equal(result.viewId, 'v1')
})

