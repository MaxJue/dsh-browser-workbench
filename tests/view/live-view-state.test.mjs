import assert from 'node:assert/strict'
import test from 'node:test'
import { liveViewState } from '../../src/view/live-view-state.ts'

test('live view state projects viewport, fit and adaptive dimensions', () => {
  const session = {
    liveView: {
      mode: 'adaptive',
      initialized: true,
      adaptiveWidth: 900,
      adaptiveHeight: 600,
      changedAt: 123,
    },
  }
  const view = {
    viewport: {
      width: 900,
      height: 600,
      generation: 4,
      reflowedElements: 2,
      contentWidth: 1400,
      fittedWidth: 900,
    },
  }

  assert.deepEqual(liveViewState(session, view), {
    mode: 'adaptive',
    initialized: true,
    width: 900,
    height: 600,
    viewportGeneration: 4,
    reflowed: true,
    contentWidth: 1400,
    fittedWidth: 900,
    reflowedElements: 2,
    changedAt: 123,
    standard: { width: 1280, height: 720 },
    adaptive: { width: 900, height: 600 },
  })
})

test('live view state reports no adaptive dimensions until both are available', () => {
  const state = liveViewState(
    { liveView: { mode: 'standard', initialized: false, adaptiveWidth: 900, adaptiveHeight: undefined, changedAt: 0 } },
    { viewport: { width: 1280, height: 720, generation: 1, reflowedElements: 0, contentWidth: 1280, fittedWidth: 1280 } },
  )
  assert.equal(state.reflowed, false)
  assert.equal(state.adaptive, null)
})

