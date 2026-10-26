import assert from 'node:assert/strict'
import test from 'node:test'
import { debuggerState, safeRemoteResult, visualCaptureState } from '../../src/runtime/runtime-projections.ts'

test('safeRemoteResult redacts secrets, marks cycles, and truncates output', () => {
  const value = { token: 'secret', nested: { password: 'hidden' } }
  value.self = value
  assert.deepEqual(safeRemoteResult(value, 1000), { token: '[REDACTED]', nested: { password: '[REDACTED]' }, self: '[Circular]' })
  assert.equal(safeRemoteResult({ value: 'abcdefgh' }, 8), '{"value"…')
})

test('visualCaptureState projects screencast consumers across views', () => {
  const session = { views: new Map([
    ['one', { cdp: { screencastStarted: true, screencastConsumers: new Set(['live-view']) } }],
    ['two', { cdp: { screencastStarted: false, screencastConsumers: new Set() } }],
    ['three', { cdp: undefined }],
  ]) }
  assert.deepEqual(visualCaptureState(session), { activeViewCount: 1, startedViewCount: 1, liveViewConsumerCount: 1, recorderConsumerCount: 0 })
})

test('debuggerState projects bounded debugger state', () => {
  const view = { cdp: { debuggerEnabled: true, paused: true, reason: 'breakpoint', callFrames: [{ callFrameId: '1' }], scripts: new Map([['a', { url: '' }], ['b', { url: 'https://example.test/app.js' }]]), breakpoints: new Map([['bp', { breakpointId: 'bp' }]]) } }
  const result = debuggerState(view)
  assert.equal(result.attached, true)
  assert.equal(result.paused, true)
  assert.deepEqual(result.scripts, [{ url: 'https://example.test/app.js' }])
  assert.deepEqual(result.breakpoints, [{ breakpointId: 'bp' }])
})
