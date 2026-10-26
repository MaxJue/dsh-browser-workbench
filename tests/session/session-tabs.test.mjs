import assert from 'node:assert/strict'
import test from 'node:test'
import { restorableTabs } from '../../src/session/session-tabs.ts'

const config = {
  allowedOrigins: new Set(),
  allowLoopback: true,
  allowPrivateNetwork: true,
}

function session(views, activeViewId, splitView = { enabled: false, focusedPane: 'top', orientation: 'top-bottom', ratio: 0.5 }) {
  return { views: new Map(views.map(view => [view.viewId, view])), activeViewId, splitView }
}

function view(viewId, url, closed = false) {
  return { viewId, kind: 'page', page: { url: () => url, isClosed: () => closed } }
}

test('restorable tabs filters closed views and preserves safe URLs', () => {
  const result = restorableTabs(session([
    view('one', 'https://example.com/one'),
    view('closed', 'https://example.com/closed', true),
    view('two', 'about:blank'),
  ], 'two'), config)

  assert.deepEqual(result, { urls: ['https://example.com/one', 'about:blank'], activeIndex: 1 })
})

test('restorable tabs replaces disallowed URLs and records a valid split', () => {
  const result = restorableTabs(session([
    view('one', 'https://example.com/one'),
    view('two', 'https://example.com/two'),
  ], 'two', { enabled: true, focusedPane: 'bottom', orientation: 'left-right', ratio: 0.6, topViewId: 'one', bottomViewId: 'two' }), config)

  assert.deepEqual(result, {
    urls: ['https://example.com/one', 'https://example.com/two'],
    activeIndex: 1,
    split: { topIndex: 0, bottomIndex: 1, focusedPane: 'bottom', orientation: 'left-right', ratio: 0.6 },
  })
})

