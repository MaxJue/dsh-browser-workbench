import assert from 'node:assert/strict'
import test from 'node:test'
import { awaitBackNavigation, stopOnAbort } from '../../src/page/page-operation.ts'

test('stopOnAbort returns an operation result and leaves the page open', async () => {
  let closed = false
  const page = { close: async () => { closed = true } }
  const controller = new AbortController()

  assert.equal(await stopOnAbort(page, controller.signal, Promise.resolve('done')), 'done')
  assert.equal(closed, false)
})

test('stopOnAbort closes the page, waits for the operation to settle, and returns abort reason', async () => {
  let closed = false
  let releaseOperation
  let operationSettled = false
  const page = { close: async options => { closed = options.runBeforeUnload === false } }
  const controller = new AbortController()
  const operation = new Promise(resolve => { releaseOperation = resolve }).then(() => { operationSettled = true })
  const result = stopOnAbort(page, controller.signal, operation)

  controller.abort(new Error('cancelled'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(closed, true)
  assert.equal(operationSettled, false)
  releaseOperation()
  await assert.rejects(result, /cancelled/)
  assert.equal(operationSettled, true)
})

test('stopOnAbort rejects immediately when the signal is already aborted', async () => {
  const controller = new AbortController()
  controller.abort(new Error('already cancelled'))
  let closed = false

  await assert.rejects(stopOnAbort({ close: async () => { closed = true } }, controller.signal, Promise.resolve()), /already cancelled/)
  assert.equal(closed, false)
})

function timeoutError() {
  return Object.assign(new Error('page.goBack: Timeout 30000ms exceeded.'), { name: 'TimeoutError' })
}

test('awaitBackNavigation resolves as soon as a bfcache restore changes the url', async () => {
  let url = 'http://fixture/second'
  const navigation = new Promise((_, reject) => { setTimeout(() => reject(timeoutError()), 60) })
  setTimeout(() => { url = 'http://fixture/' }, 10)

  await awaitBackNavigation({ url: () => url }, 'http://fixture/second', navigation, 5)
  assert.equal(url, 'http://fixture/')
})

test('awaitBackNavigation tolerates a navigation timeout only when the url moved', async () => {
  const stuck = new Promise((_, reject) => { setTimeout(() => reject(timeoutError()), 10) })
  await assert.rejects(awaitBackNavigation({ url: () => 'http://fixture/second' }, 'http://fixture/second', stuck, 5), /Timeout 30000ms/)
})

test('awaitBackNavigation rethrows failures that are not navigation timeouts', async () => {
  const failed = Promise.reject(Object.assign(new Error('net::ERR_FAILED'), { name: 'Error' }))
  await assert.rejects(awaitBackNavigation({ url: () => 'http://fixture/' }, 'http://fixture/second', failed, 5), /ERR_FAILED/)
})

