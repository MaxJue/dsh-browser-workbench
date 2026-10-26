import assert from 'node:assert/strict'
import test from 'node:test'
import { forceStopScreencast, releaseScreencast, restartScreencast, startScreencast } from '../../src/view/screencast.ts'

function makeView() {
  const calls = []
  const view = {
    cdp: {
      session: { send: async (method, params) => { calls.push([method, params]); return {} } },
      screencastConsumers: new Set(),
      screencastStarted: false,
      latestFrame: { data: 'old-frame' },
    },
  }
  return { view, calls }
}

test('screencast shares a stream and only stops after the final consumer releases', async () => {
  const { view, calls } = makeView()
  await startScreencast(view, 'live-view')
  await startScreencast(view, 'recorder')
  assert.equal(calls.filter(([method]) => method === 'Page.startScreencast').length, 1)
  await releaseScreencast(view, 'live-view')
  assert.equal(calls.filter(([method]) => method === 'Page.stopScreencast').length, 0)
  await releaseScreencast(view, 'recorder')
  assert.equal(calls.filter(([method]) => method === 'Page.stopScreencast').length, 1)
  assert.equal(view.cdp.screencastStarted, false)
  assert.equal(view.cdp.latestFrame, undefined)
})

test('screencast restart preserves consumers and force stop clears them', async () => {
  const { view, calls } = makeView()
  await startScreencast(view, 'recorder')
  assert.equal(await restartScreencast(view), 'recorder')
  assert.equal(view.cdp.screencastConsumers.has('recorder'), true)
  await forceStopScreencast(view)
  assert.equal(view.cdp.screencastConsumers.size, 0)
  assert.equal(view.cdp.screencastStarted, false)
  assert.equal(calls.filter(([method]) => method === 'Page.stopScreencast').length, 2)
})

