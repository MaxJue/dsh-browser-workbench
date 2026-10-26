import assert from 'node:assert/strict'
import test from 'node:test'
import { queueExclusive, queueExclusiveMany } from '../../src/session/session-queue.ts'

const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('serializes operations in submission order', async () => {
  const state = { queue: Promise.resolve() }
  const first = deferred()
  const events = []
  const running = queueExclusive(state, async () => { events.push('first:start'); await first.promise; events.push('first:end'); return 1 })
  const next = queueExclusive(state, async () => { events.push('second'); return 2 })
  await Promise.resolve()
  assert.deepEqual(events, ['first:start'])
  first.resolve()
  assert.equal(await running, 1)
  assert.equal(await next, 2)
  assert.deepEqual(events, ['first:start', 'first:end', 'second'])
})

test('releases the queue after a rejected operation', async () => {
  const state = { queue: Promise.resolve() }
  await assert.rejects(queueExclusive(state, async () => { throw new Error('failed') }), /failed/)
  await assert.doesNotReject(queueExclusive(state, async () => 'recovered'))
})

test('does not deadlock if initial queue promise was rejected', async () => {
  const state = { queue: Promise.reject(new Error('prior failure')) }
  // state.queue is rejected, but next operation should still be allowed to run and release cleanly
  const result = await queueExclusive(state, async () => 'healed')
  assert.equal(result, 'healed')
  assert.equal(await queueExclusive(state, async () => 'next'), 'next')
})

test('multi-state queue locks states by stable key and releases them in reverse order', async () => {
  const first = { key: 'b', queue: Promise.resolve() }
  const second = { key: 'a', queue: Promise.resolve() }
  const events = []
  const result = await queueExclusiveMany([first, second], state => state.key, async () => {
    events.push('operation')
    return 7
  })
  assert.equal(result, 7)
  assert.deepEqual(events, ['operation'])
  assert.equal(await queueExclusive(first, async () => 'first-unlocked'), 'first-unlocked')
  assert.equal(await queueExclusive(second, async () => 'second-unlocked'), 'second-unlocked')
})

test('multi-state queue releases all acquired locks if one state queue was rejected', async () => {
  const first = { key: 'a', queue: Promise.resolve() }
  const second = { key: 'b', queue: Promise.reject(new Error('stale error')) }
  const result = await queueExclusiveMany([first, second], state => state.key, async () => 'multi-healed')
  assert.equal(result, 'multi-healed')
  assert.equal(await queueExclusive(first, async () => 'first-ok'), 'first-ok')
  assert.equal(await queueExclusive(second, async () => 'second-ok'), 'second-ok')
})

