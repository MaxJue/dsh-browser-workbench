import assert from 'node:assert/strict'
import test from 'node:test'
import { connectExternalCdp } from '../../src/provider/external-cdp.ts'

test('external CDP connection prepares and returns the existing default context', async () => {
  const context = {}
  const browser = {
    contexts: () => [context],
    close: async () => assert.fail('connected browser must remain open'),
  }
  const prepared = []
  let connectArgs
  const result = await connectExternalCdp('http://127.0.0.1:9222', 1200, async value => prepared.push(value), async (...args) => {
    connectArgs = args
    return browser
  })

  assert.equal(result.browser, browser)
  assert.equal(result.context, context)
  assert.deepEqual(prepared, [context])
  assert.deepEqual(connectArgs, ['http://127.0.0.1:9222', { timeout: 1200 }])
})

test('external CDP connection closes an unusable transport when no default context exists', async () => {
  let closed = false
  const browser = { contexts: () => [], close: async () => { closed = true } }

  await assert.rejects(
    connectExternalCdp('http://127.0.0.1:9222', 1200, async () => {}, async () => browser),
    error => error.code === 'PROVIDER_UNAVAILABLE',
  )
  assert.equal(closed, true)
})

