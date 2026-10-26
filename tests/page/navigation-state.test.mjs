import assert from 'node:assert/strict'
import test from 'node:test'
import { commitMainFrameNavigation, isNavigationTimeoutError } from '../../src/page/navigation-state.ts'

function view(pendingNavigationId) {
  return {
    viewId: 'v2',
    navigationGeneration: 4,
    navigationId: 'v2-n4',
    pendingNavigationId,
    documentGeneration: 7,
    viewport: {
      generation: 3,
      width: 1280,
      contentWidth: 1800,
      fittedWidth: 1600,
      reflowedElements: 5,
      fitDocumentGeneration: 6,
    },
    cdp: { latestFrame: { data: 'stale' } },
    lastSnapshot: { data: 'stale' },
  }
}

test('main-frame navigation advances identity and invalidates document projections', () => {
  const state = view(undefined)
  const committed = commitMainFrameNavigation(state)

  assert.deepEqual(committed, { navigationId: 'v2-n5', documentGeneration: 8 })
  assert.equal(state.navigationGeneration, 5)
  assert.equal(state.viewport.generation, 4)
  assert.equal(state.viewport.contentWidth, 1280)
  assert.equal(state.viewport.fittedWidth, 1280)
  assert.equal(state.viewport.reflowedElements, 0)
  assert.equal(state.viewport.fitDocumentGeneration, -1)
  assert.equal(state.cdp.latestFrame, undefined)
  assert.equal(state.lastSnapshot, undefined)
})

test('only Playwright navigation timeouts count as restorable bfcache timeouts', () => {
  const timeout = Object.assign(new Error('page.goBack: Timeout 30000ms exceeded.'), { name: 'TimeoutError' })

  assert.equal(isNavigationTimeoutError(timeout), true)
  assert.equal(isNavigationTimeoutError(new Error('Timeout 30000ms exceeded.')), false)
  assert.equal(isNavigationTimeoutError({ name: 'TimeoutError' }), true)
  assert.equal(isNavigationTimeoutError('TimeoutError'), false)
  assert.equal(isNavigationTimeoutError(null), false)
})

test('main-frame navigation commits a pending navigation identity', () => {
  const state = view('v2-n5')
  const committed = commitMainFrameNavigation(state)

  assert.deepEqual(committed, { navigationId: 'v2-n5', documentGeneration: 8 })
  assert.equal(state.navigationGeneration, 4)
  assert.equal(state.pendingNavigationId, undefined)
})

