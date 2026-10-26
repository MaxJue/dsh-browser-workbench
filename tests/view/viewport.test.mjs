import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_ADAPTIVE_VIEWPORT,
  MIN_ADAPTIVE_VIEWPORT,
  MIN_SPLIT_ADAPTIVE_VIEWPORT,
  normalizeAdaptiveViewport,
  STANDARD_VIEWPORT,
} from '../../src/view/viewport.ts'

test('exports stable standard and adaptive viewport bounds', () => {
  assert.deepEqual(STANDARD_VIEWPORT, { width: 1280, height: 720 })
  assert.deepEqual(MIN_ADAPTIVE_VIEWPORT, { width: 320, height: 240 })
  assert.deepEqual(MIN_SPLIT_ADAPTIVE_VIEWPORT, { width: 160, height: 120 })
  assert.deepEqual(MAX_ADAPTIVE_VIEWPORT, { width: 1920, height: 1200 })
})

test('rounds dimensions and clamps to the regular adaptive limits', () => {
  assert.deepEqual(normalizeAdaptiveViewport(319.6, 241.4), { width: 320, height: 241 })
  assert.deepEqual(normalizeAdaptiveViewport(5000, 2), { width: 1920, height: 240 })
})

test('supports the smaller minimum used by split panes', () => {
  assert.deepEqual(normalizeAdaptiveViewport(100, 80, MIN_SPLIT_ADAPTIVE_VIEWPORT), { width: 160, height: 120 })
})

test('rejects non-finite dimensions', () => {
  assert.throws(() => normalizeAdaptiveViewport(Number.NaN, 500), /requires finite width and height/)
  assert.throws(() => normalizeAdaptiveViewport(500, Number.POSITIVE_INFINITY), /requires finite width and height/)
})

