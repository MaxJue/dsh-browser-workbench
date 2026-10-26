import assert from 'node:assert/strict'
import test from 'node:test'
import { applyLiveViewport, applyVisibleLiveViewports } from '../../src/view/live-viewport.ts'

function deps(calls) {
  return {
    splitPaneForView: () => undefined,
    liveViewport: () => ({ width: 1280, height: 720 }),
    setViewViewport: async (...args) => calls.push(['set', ...args.slice(2)]),
    applyAdaptiveFit: async () => calls.push(['adaptive']),
    clearAdaptiveFit: async () => calls.push(['clear']),
  }
}

test('applyLiveViewport applies standard dimensions and clears adaptive reflow', async () => {
  const calls = []
  const session = { liveView: { mode: 'standard' }, splitView: { panes: {} } }
  const view = { viewId: 'v1', page: { isClosed: () => false } }

  await applyLiveViewport(session, view, deps(calls))

  assert.deepEqual(calls, [['set', 1280, 720], ['clear']])
})

test('applyLiveViewport waits for split pane dimensions before adaptive fitting', async () => {
  const calls = []
  const session = { liveView: { mode: 'adaptive' }, splitView: { panes: { top: {} } } }
  const view = { viewId: 'v1', page: { isClosed: () => false } }
  const dependencies = { ...deps(calls), splitPaneForView: () => 'top' }

  await applyLiveViewport(session, view, dependencies)

  assert.deepEqual(calls, [])
})

test('applyVisibleLiveViewports skips closed and unknown views', async () => {
  const calls = []
  const open = { viewId: 'open', page: { isClosed: () => false } }
  const closed = { viewId: 'closed', page: { isClosed: () => true } }
  const views = new Map([['open', open], ['closed', closed]])
  const session = { liveView: { mode: 'standard' }, splitView: { panes: {} } }

  await applyVisibleLiveViewports(session, new Set(['open', 'closed', 'missing']), views, deps(calls))

  assert.deepEqual(calls, [['set', 1280, 720], ['clear']])
})

