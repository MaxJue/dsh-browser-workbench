import assert from 'node:assert/strict'
import test from 'node:test'
import { liveViewport, splitPaneForView, splitPaneView, splitSnapshot, visibleViewIds } from '../../src/view/view-layout.ts'

function view(viewId, closed = false) {
  return { viewId, kind: 'page', page: { isClosed: () => closed } }
}

function session(overrides = {}) {
  const top = view('top')
  const bottom = view('bottom')
  return {
    views: new Map([top, bottom].map(item => [item.viewId, item])),
    activeViewId: 'top',
    extensionPopup: undefined,
    splitView: { enabled: true, topViewId: 'top', bottomViewId: 'bottom', focusedPane: 'top', orientation: 'top-bottom', ratio: 0.5, changedAt: 1 },
    liveView: { mode: 'adaptive', fixedWidth: 1280, fixedHeight: 720, adaptiveWidth: 800, adaptiveHeight: 600 },
    ...overrides,
  }
}

test('selects live dimensions and split panes', () => {
  const state = session()
  assert.deepEqual(liveViewport(state), { width: 800, height: 600 })
  assert.equal(splitPaneView(state, 'top').viewId, 'top')
  assert.equal(splitPaneView(state, 'bottom').viewId, 'bottom')
  assert.equal(splitPaneForView(state, 'bottom'), 'bottom')
  assert.equal(splitPaneForView({ ...state, splitView: { ...state.splitView, enabled: false } }, 'bottom'), undefined)
})

test('tracks visible split views and extension popup', () => {
  const popup = view('popup')
  const state = session({ extensionPopup: { view: popup } })
  assert.deepEqual([...visibleViewIds(state)], ['top', 'bottom', 'popup'])
  assert.deepEqual([...visibleViewIds({ ...state, splitView: { ...state.splitView, enabled: false } })], ['top', 'popup'])
})

test('omits closed panes and preserves split snapshot fields', () => {
  const state = session({ views: new Map([['top', view('top', true)], ['bottom', view('bottom')]]) })
  assert.equal(splitPaneView(state, 'top'), undefined)
  assert.deepEqual(splitSnapshot(state), { enabled: true, focusedPane: 'top', orientation: 'top-bottom', ratio: 0.5, changedAt: 1, topViewId: 'top', bottomViewId: 'bottom' })
})

