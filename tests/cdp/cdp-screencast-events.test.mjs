import assert from 'node:assert/strict'
import test from 'node:test'
import { bindCdpScreencastEvents } from '../../src/cdp/cdp-screencast-events.ts'

test('screencast frames update bounded state, ACK, and record deep visual evidence', async () => {
  const handlers = new Map()
  const sends = []
  const recorded = []
  const client = { on: (event, listener) => handlers.set(event, listener), send: async (...args) => sends.push(args) }
  const state = { streamGeneration: 3, frameSequence: 0, lastAcceptedFrameAt: 0, latestFrame: undefined }
  const session = { sessionId: 's1', key: 's1@1' }
  const view = { viewId: 'v1', documentGeneration: 2, navigationId: 'v1-n1', viewport: { generation: 4 } }
  bindCdpScreencastEvents(client, state, session, view, {
    recorderStatus: () => ({ mode: 'deep', status: 'recording' }),
    recordVisualFrame: (...args) => recorded.push(args),
  })

  handlers.get('Page.screencastFrame')({ sessionId: 8, data: 'base64-jpeg', metadata: { deviceWidth: 640, deviceHeight: 480 } })
  await Promise.resolve()

  assert.deepEqual(state.latestFrame, {
    streamGeneration: 3,
    sequence: 1,
    mediaType: 'image/jpeg',
    data: 'base64-jpeg',
    width: 640,
    height: 480,
    viewportGeneration: 4,
  })
  assert.equal(recorded.length, 1)
  assert.equal(recorded[0][2].frameSequence, 1)
  assert.deepEqual(sends, [['Page.screencastFrameAck', { sessionId: 8 }]])
})

test('screencast frames received inside the 33ms window are ACKed without replacing state', async () => {
  const handlers = new Map()
  const sends = []
  const client = { on: (event, listener) => handlers.set(event, listener), send: async (...args) => sends.push(args) }
  const state = { streamGeneration: 1, frameSequence: 1, lastAcceptedFrameAt: Date.now(), latestFrame: { sequence: 1, data: 'old' } }
  const view = { viewId: 'v1', viewport: { generation: 1 } }
  bindCdpScreencastEvents(client, state, { sessionId: 's1', key: 's1@1' }, view, {
    recorderStatus: () => ({ mode: 'off', status: 'idle' }),
    recordVisualFrame: () => assert.fail('throttled frame must not be recorded'),
  })

  handlers.get('Page.screencastFrame')({ sessionId: 9, data: 'new', metadata: { deviceWidth: 1, deviceHeight: 1 } })
  await Promise.resolve()

  assert.equal(state.frameSequence, 1)
  assert.equal(state.latestFrame.data, 'old')
  assert.deepEqual(sends, [['Page.screencastFrameAck', { sessionId: 9 }]])
})

