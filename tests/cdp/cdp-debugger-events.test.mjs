import assert from 'node:assert/strict'
import test from 'node:test'
import { bindCdpDebuggerLifecycle, bindCdpTargetLifecycle } from '../../src/cdp/cdp-debugger-events.ts'

test('debugger events project paused frames and clear pause state on resume', () => {
  const handlers = new Map()
  const client = { on: (event, listener) => handlers.set(event, listener) }
  const state = { paused: false, callFrames: [] }
  bindCdpDebuggerLifecycle(client, state)

  handlers.get('Debugger.paused')({ reason: 'breakpoint', callFrames: [{ callFrameId: 'frame-1', functionName: 'run', url: 'https://example.test', location: { lineNumber: 3, columnNumber: 4 }, scopeChain: [] }] })
  assert.equal(state.paused, true)
  assert.equal(state.reason, 'breakpoint')
  assert.equal(state.callFrames[0].callFrameId, 'frame-1')

  handlers.get('Debugger.resumed')({})
  assert.equal(state.paused, false)
  assert.equal(state.reason, undefined)
  assert.deepEqual(state.callFrames, [])
})

test('target lifecycle events deactivate contexts and targets', () => {
  const handlers = new Map()
  const client = { on: (event, listener) => handlers.set(event, listener) }
  const state = { contextAdapter: { mainContext: () => ({ targetId: 'main-target' }) } }
  const calls = []
  bindCdpTargetLifecycle(client, { key: 'session@1' }, state, {
    deactivateExecutionContext: (...args) => calls.push(['context', ...args]),
    deactivateTarget: (...args) => calls.push(['target', ...args]),
  })

  handlers.get('Runtime.executionContextDestroyed')({ executionContextId: 7 })
  handlers.get('Runtime.executionContextDestroyed')({ executionContextId: 0 })
  handlers.get('Runtime.executionContextsCleared')({})
  handlers.get('Target.detachedFromTarget')({ targetId: 'child-target' })
  handlers.get('Target.detachedFromTarget')({ targetId: '' })

  assert.deepEqual(calls, [
    ['context', 'session@1', 7],
    ['target', 'session@1', 'main-target'],
    ['target', 'session@1', 'child-target'],
  ])
})

