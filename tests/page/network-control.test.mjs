import assert from 'node:assert/strict'
import test from 'node:test'
import { networkControlAction } from '../../src/page/network-control.ts'

function setup() {
  const sent = []
  const state = {
    session: { send: async (...args) => { sent.push(args); return {} } },
    networkEnabled: false,
    pausedRequests: new Map(),
    profile: { artifacts: [] },
  }
  const artifacts = []
  const dependencies = {
    state,
    viewId: 'view-1',
    maxOutputChars: 4,
    saveArtifact: async (kind, name, body) => {
      const artifact = { artifactId: `a${artifacts.length + 1}`, kind, name, bytes: body.byteLength, createdAt: 1 }
      artifacts.push({ artifact, body })
      return artifact
    },
    replay: async (url, method, postData) => {
      dependencies.replayed = { url, method, postData }
      return { status: 201, body: Buffer.from('replayed') }
    },
  }
  return { state, sent, artifacts, dependencies }
}

function pausedRequest(overrides = {}) {
  return {
    requestId: 'request-1',
    url: 'https://example.test/?token=%5BREDACTED%5D',
    rawUrl: 'https://example.test/?token=secret',
    method: 'POST',
    resourceType: 'XHR',
    requestStage: 'request',
    headers: [],
    postData: 'payload',
    createdAt: 1,
    timer: setTimeout(() => {}, 10000),
    ...overrides,
  }
}

test('network enable builds request patterns and list_paused projects safe metadata', async () => {
  const { state, sent, dependencies } = setup()
  state.pausedRequests.set('request-1', pausedRequest())

  const result = await networkControlAction({ action: 'enable', urlPattern: '  https://example.test/* ', resourceType: 'XHR', requestStage: 'response' }, dependencies)

  assert.equal(state.networkEnabled, true)
  assert.deepEqual(sent, [['Fetch.enable', { patterns: [{ urlPattern: 'https://example.test/*', resourceType: 'XHR', requestStage: 'Response' }], handleAuthRequests: false }]])
  assert.equal(result.data.pausedRequests[0].url, 'https://example.test/?token=%5BREDACTED%5D')
  clearTimeout(state.pausedRequests.get('request-1').timer)
})

test('network disable releases paused requests and disables Fetch', async () => {
  const { state, sent, dependencies } = setup()
  state.networkEnabled = true
  state.pausedRequests.set('request-1', pausedRequest())

  const result = await networkControlAction({ action: 'disable' }, dependencies)

  assert.equal(state.networkEnabled, false)
  assert.equal(state.pausedRequests.size, 0)
  assert.deepEqual(sent, [
    ['Fetch.continueRequest', { requestId: 'request-1' }],
    ['Fetch.disable'],
  ])
  assert.deepEqual(result.data.pausedRequests, [])
})

test('body returns small request payloads and stores oversized bodies as artifacts', async () => {
  const { state, artifacts, dependencies } = setup()
  state.pausedRequests.set('small', pausedRequest({ requestId: 'small', postData: 'ok' }))
  state.pausedRequests.set('large', pausedRequest({ requestId: 'large', postData: 'payload' }))

  const small = await networkControlAction({ action: 'body', requestId: 'small' }, dependencies)
  const large = await networkControlAction({ action: 'body', requestId: 'large' }, dependencies)

  assert.equal(small.data.body, 'ok')
  assert.equal(large.data.artifact.artifactId, 'a1')
  assert.equal(artifacts[0].body.toString(), 'payload')
  assert.equal(state.profile.artifacts.length, 1)
  for (const request of state.pausedRequests.values()) clearTimeout(request.timer)
})

test('response body decodes base64 from CDP', async () => {
  const { state, sent, dependencies } = setup()
  dependencies.maxOutputChars = 20
  state.session.send = async (...args) => {
    sent.push(args)
    return { body: Buffer.from('response').toString('base64'), base64Encoded: true }
  }
  state.pausedRequests.set('request-1', pausedRequest({ requestStage: 'response' }))

  const result = await networkControlAction({ action: 'body', requestId: 'request-1' }, dependencies)

  assert.equal(result.data.body, Buffer.from('response').toString('base64'))
  assert.equal(result.data.base64Encoded, true)
  assert.deepEqual(sent, [['Fetch.getResponseBody', { requestId: 'request-1' }]])
  clearTimeout(state.pausedRequests.get('request-1').timer)
})

test('replay preserves request metadata and stores the response body', async () => {
  const { state, artifacts, dependencies } = setup()
  state.pausedRequests.set('request-1', pausedRequest())

  const result = await networkControlAction({ action: 'replay', requestId: 'request-1' }, dependencies)

  assert.deepEqual(dependencies.replayed, { url: 'https://example.test/?token=secret', method: 'POST', postData: 'payload' })
  assert.equal(result.data.status, 201)
  assert.equal(result.data.bytes, 8)
  assert.equal(artifacts[0].artifact.kind, 'network-replay')
  assert.equal(state.profile.artifacts.length, 1)
  clearTimeout(state.pausedRequests.get('request-1').timer)
})

test('continue, abort and fulfill remove paused entries and issue the matching CDP command', async () => {
  for (const [input, expected] of [
    [{ action: 'continue' }, ['Fetch.continueRequest', { requestId: 'request-1' }]],
    [{ action: 'abort', errorReason: 'BlockedByClient' }, ['Fetch.failRequest', { requestId: 'request-1', errorReason: 'BlockedByClient' }]],
    [{ action: 'fulfill', responseCode: 202, body: 'ok', headers: [{ name: 'X-Test', value: 'yes' }] }, ['Fetch.fulfillRequest', { requestId: 'request-1', responseCode: 202, responseHeaders: [{ name: 'X-Test', value: 'yes' }], body: Buffer.from('ok').toString('base64') }]],
  ]) {
    const { state, sent, dependencies } = setup()
    state.pausedRequests.set('request-1', pausedRequest())

    await networkControlAction({ ...input, requestId: 'request-1' }, dependencies)

    assert.deepEqual(sent, [expected])
    assert.equal(state.pausedRequests.size, 0)
  }
})

test('unknown paused requests return a recoverable next action', async () => {
  const { dependencies } = setup()

  const result = await networkControlAction({ action: 'continue', requestId: 'missing' }, dependencies)

  assert.equal(result.ok, false)
  assert.equal(result.data.code, 'UNKNOWN_PAUSED_REQUEST')
  assert.deepEqual(result.data.next.arguments, { action: 'list_paused', viewId: 'view-1' })
})

