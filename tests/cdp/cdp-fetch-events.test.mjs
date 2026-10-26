import assert from 'node:assert/strict'
import test from 'node:test'
import { bindCdpFetchEvents } from '../../src/cdp/cdp-fetch-events.ts'

test('Fetch.requestPaused stores redacted request metadata and auto-releases after timeout', async () => {
  const handlers = new Map()
  const sends = []
  const client = {
    on: (event, listener) => handlers.set(event, listener),
    send: async (...args) => sends.push(args),
  }
  const state = { pausedRequests: new Map() }
  bindCdpFetchEvents(client, state, 5)
  handlers.get('Fetch.requestPaused')({
    requestId: 'request-1',
    networkId: 'network-1',
    resourceType: 'Document',
    request: {
      url: 'https://example.test/?token=secret',
      method: 'POST',
      headers: { Authorization: 'Bearer abc', Accept: 'text/html' },
      postData: 'hello',
    },
  })

  const paused = state.pausedRequests.get('request-1')
  assert.equal(paused.url, 'https://example.test/?token=%5BREDACTED%5D')
  assert.deepEqual(paused.headers, [
    { name: 'Authorization', value: '[REDACTED]' },
    { name: 'Accept', value: 'text/html' },
  ])
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal(state.pausedRequests.has('request-1'), false)
  assert.deepEqual(sends, [['Fetch.continueRequest', { requestId: 'request-1' }]])
})

test('Fetch.requestPaused ignores requests without an id', () => {
  const handlers = new Map()
  const state = { pausedRequests: new Map() }
  bindCdpFetchEvents({ on: (event, listener) => handlers.set(event, listener), send: async () => {} }, state, 10)
  handlers.get('Fetch.requestPaused')({ request: { url: 'https://example.test' } })
  assert.equal(state.pausedRequests.size, 0)
})

