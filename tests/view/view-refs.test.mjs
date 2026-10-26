import assert from 'node:assert/strict'
import test from 'node:test'
import { releaseHandles, releaseViewRefs } from '../../src/view/view-refs.ts'

test('releaseHandles disposes each unique handle once', async () => {
  const calls = []
  const handle = { dispose: async () => calls.push('shared') }
  await releaseHandles([handle, handle, { dispose: async () => calls.push('other') }])
  assert.deepEqual(calls.sort(), ['other', 'shared'])
})

test('releaseViewRefs invalidates refs before disposing handles', async () => {
  const states = []
  const handle = { dispose: async () => states.push('disposed') }
  const view = { refs: new Map([['ref', { handle }]]) }
  await releaseViewRefs(view)
  assert.equal(view.refs.size, 0)
  assert.deepEqual(states, ['disposed'])
})

