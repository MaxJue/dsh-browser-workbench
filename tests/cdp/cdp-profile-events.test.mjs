import assert from 'node:assert/strict'
import test from 'node:test'
import { bindCdpProfileEvents } from '../../src/cdp/cdp-profile-events.ts'

test('profile events resolve tracing and collect bounded heap snapshot chunks', () => {
  const handlers = new Map()
  const client = { on: (event, listener) => handlers.set(event, listener) }
  const trace = []
  const state = {
    profile: {
      resolveTrace: value => trace.push(value),
      heapSnapshotChunks: [],
      heapSnapshotBytes: 0,
      heapSnapshotOverflow: false,
    },
  }
  bindCdpProfileEvents(client, state, 10)

  handlers.get('Tracing.tracingComplete')({ stream: 'stream-1' })
  handlers.get('HeapProfiler.addHeapSnapshotChunk')({ chunk: '12345' })
  handlers.get('HeapProfiler.addHeapSnapshotChunk')({ chunk: '67890' })

  assert.deepEqual(trace, [{ stream: 'stream-1' }])
  assert.deepEqual(state.profile.heapSnapshotChunks, ['12345', '67890'])
  assert.equal(state.profile.heapSnapshotBytes, 10)
  assert.equal(state.profile.resolveTrace, undefined)
})

test('profile events discard heap data after the configured artifact limit', () => {
  const handlers = new Map()
  const client = { on: (event, listener) => handlers.set(event, listener) }
  const state = { profile: { heapSnapshotChunks: [], heapSnapshotBytes: 0, heapSnapshotOverflow: false } }
  bindCdpProfileEvents(client, state, 4)

  handlers.get('HeapProfiler.addHeapSnapshotChunk')({ chunk: '12345' })
  handlers.get('HeapProfiler.addHeapSnapshotChunk')({ chunk: '6' })

  assert.equal(state.profile.heapSnapshotOverflow, true)
  assert.deepEqual(state.profile.heapSnapshotChunks, [])
  handlers.get('HeapProfiler.addHeapSnapshotChunk')({ chunk: '7' })
  assert.deepEqual(state.profile.heapSnapshotChunks, [])
})

