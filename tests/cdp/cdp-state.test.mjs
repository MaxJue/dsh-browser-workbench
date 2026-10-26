import assert from 'node:assert/strict'
import test from 'node:test'
import { createCdpState, pausedCallFrames } from '../../src/cdp/cdp-state.ts'

test('createCdpState initializes isolated debugger, stream, network, and profile state', () => {
  const session = {}
  const state = createCdpState(session, 4)
  assert.equal(state.session, session)
  assert.equal(state.streamGeneration, 5)
  assert.equal(state.debuggerEnabled, false)
  assert.equal(state.networkEnabled, false)
  assert.deepEqual(state.callFrames, [])
  assert.deepEqual(state.profile.artifacts, [])
})

test('pausedCallFrames normalizes untrusted frame and scope payloads', () => {
  const frames = pausedCallFrames({ callFrames: [{ callFrameId: 'frame-1', functionName: '', url: 'https://example.test/app.js', location: { lineNumber: 8, columnNumber: 2 }, scopeChain: [{ type: 'local', name: 'local', object: { objectId: 'object-1' } }] }] })
  assert.deepEqual(frames, [{ callFrameId: 'frame-1', functionName: '(anonymous)', url: 'https://example.test/app.js', lineNumber: 8, columnNumber: 2, scopes: [{ type: 'local', name: 'local', objectId: 'object-1' }] }])
})

