import assert from 'node:assert/strict'
import test from 'node:test'
import { syncScreencasts } from '../../src/view/screencast-sync.ts'

test('syncScreencasts retains live and recorder consumers only for visible views', async () => {
  const calls = []
  const first = { viewId: 'v1' }
  const second = { viewId: 'v2' }
  const session = { liveView: { open: true }, sessionId: 's1', key: 's1@1' }

  await syncScreencasts(session, [first, second], {
    visibleViewIds: () => new Set(['v1']),
    recorderStatus: () => ({ mode: 'deep', status: 'recording' }),
    ensureScreencast: async (_session, view, consumer) => calls.push(['ensure', view.viewId, consumer]),
    releaseScreencast: async (view, consumer) => calls.push(['release', view.viewId, consumer]),
  })

  assert.deepEqual(calls.sort(), [
    ['ensure', 'v1', 'live-view'],
    ['ensure', 'v1', 'recorder'],
    ['release', 'v2', 'live-view'],
    ['release', 'v2', 'recorder'],
  ].sort())
})

test('syncScreencasts releases live consumers when the live panel is closed', async () => {
  const calls = []
  const view = { viewId: 'v1' }
  await syncScreencasts({ liveView: { open: false }, sessionId: 's1', key: 's1@1' }, [view], {
    visibleViewIds: () => new Set(['v1']),
    recorderStatus: () => ({ mode: 'off', status: 'idle' }),
    ensureScreencast: async () => calls.push('ensure'),
    releaseScreencast: async (_view, consumer) => calls.push(consumer),
  })
  assert.deepEqual(calls, ['live-view', 'recorder'])
})

