import assert from 'node:assert/strict'
import test from 'node:test'
import { createPort } from '../../src/client/port.ts'

function connectionWith(response) {
  const calls = []
  return {
    calls,
    connection: {
      rpc: {
        async call(...args) {
          calls.push(args)
          return response
        },
      },
    },
  }
}

test('port maps endpoint calls and unwraps successful responses', async () => {
  const fixture = connectionWith({ ok: true, value: { status: 'ready' } })
  const port = createPort(fixture.connection)
  assert.deepEqual(await port.controllerStatus('session-a'), { status: 'ready' })
  assert.deepEqual(fixture.calls, [['/api', 'browser-tools', { endpoint: 'controller_status', payload: { sessionId: 'session-a' } }]])
})

test('port preserves payload fields for snapshot and tabs', async () => {
  const fixture = connectionWith({ ok: true, value: null })
  const port = createPort(fixture.connection)
  await port.snapshot('session-a', 'live', 2, 7, { main: { frameId: 'frame-a' } }, undefined, 4)
  await port.tabs('session-a', { action: 'refresh' })
  assert.deepEqual(fixture.calls[0], ['/api', 'browser-tools', {
    endpoint: 'snapshot',
    payload: { sessionId: 'session-a', view: 'live', streamGeneration: 2, sequence: 7, splitCursors: { main: { frameId: 'frame-a' } }, popupCursor: undefined, diagnosticReadSequence: 4 },
  }])
  assert.deepEqual(fixture.calls[1], ['/api', 'browser-tools', { endpoint: 'tabs', payload: { sessionId: 'session-a', action: 'refresh' } }])
})

test('port turns failed responses into errors and close resolves success', async () => {
  const failure = connectionWith({ ok: false, error: { message: 'permission denied' } })
  const port = createPort(failure.connection)
  await assert.rejects(() => port.close('session-a', 'live'), /permission denied/)

  const success = connectionWith({ ok: true, value: undefined })
  await createPort(success.connection).close('session-a', 'live')
})

