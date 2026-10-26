import assert from 'node:assert/strict'
import test from 'node:test'
import { mutateLiveViewState } from '../../src/view/live-view-actions.ts'

function session(overrides = {}) {
  return {
    liveView: {
      mode: 'adaptive',
      initialized: false,
      fixedWidth: 1280,
      fixedHeight: 720,
      adaptiveWidth: 800,
      adaptiveHeight: 600,
      changedAt: 1,
      ...overrides,
    },
  }
}

test('initialize applies initial mode once and records supplied adaptive dimensions', () => {
  const state = session()
  const result = mutateLiveViewState(state, { action: 'initialize', mode: 'standard', width: 900, height: 700 })
  assert.equal(result.mutation, 'initialize')
  assert.equal(result.changed, false)
  assert.equal(state.liveView.mode, 'standard')
  assert.equal(state.liveView.initialized, true)
  assert.deepEqual([state.liveView.adaptiveWidth, state.liveView.adaptiveHeight], [900, 700])
})

test('resize reports whether the normalized adaptive dimensions changed', () => {
  const state = session({ initialized: true })
  const changed = mutateLiveViewState(state, { action: 'resize', width: 900.4, height: 700.2 })
  const unchanged = mutateLiveViewState(state, { action: 'resize', width: 900, height: 700 })
  assert.equal(changed.changed, true)
  assert.equal(unchanged.changed, false)
  assert.deepEqual([state.liveView.adaptiveWidth, state.liveView.adaptiveHeight], [900, 700])
})

test('adaptive transition without a measured size is recoverable and leaves state unchanged', () => {
  const state = session({ mode: 'standard', adaptiveWidth: undefined, adaptiveHeight: undefined })
  const before = { ...state.liveView }
  const result = mutateLiveViewState(state, { action: 'adaptive' })
  assert.equal(result.adaptiveUnavailable, true)
  assert.deepEqual(state.liveView, before)
})

test('standard transition updates fixed dimensions and adaptive transition uses current dimensions', () => {
  const state = session({ mode: 'adaptive', initialized: true })
  const standard = mutateLiveViewState(state, { action: 'standard' })
  assert.equal(standard.changed, true)
  assert.deepEqual([state.liveView.fixedWidth, state.liveView.fixedHeight], [1280, 720])
  const adaptive = mutateLiveViewState(state, { action: 'adaptive' })
  assert.equal(adaptive.changed, true)
  assert.equal(state.liveView.mode, 'adaptive')
})

