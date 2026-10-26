import assert from 'node:assert/strict'
import test from 'node:test'
import { bindPageNetworkEvents } from '../../src/page/page-network-events.ts'

test('page network events record responses and forward request creation', () => {
  const handlers = new Map()
  const journalEvents = []
  const recorderEvents = []
  const request = {
    method: () => 'GET',
    resourceType: () => 'document',
    frame: () => ({}),
  }
  const page = { on: (event, listener) => handlers.set(event, listener) }
  const session = { sessionId: 'session', key: 'session@1' }
  const view = { viewId: 'v1', documentGeneration: 2, navigationId: 'v1-n1', network: [] }
  const legacy = { status: undefined }
  const legacyRequests = new WeakMap([[request, legacy]])
  const journal = {
    recordResponse: (...args) => journalEvents.push(['response', ...args]),
    recordRequestFinished: (...args) => journalEvents.push(['finished', ...args]),
  }
  const recorder = { record: (...args) => recorderEvents.push(args) }
  const requested = []

  bindPageNetworkEvents(page, session, view, legacyRequests, journal, recorder, item => requested.push(item))
  handlers.get('request')(request)
  handlers.get('response')({ request: () => request, status: () => 204 })
  handlers.get('requestfinished')(request)

  assert.deepEqual(requested, [request])
  assert.equal(legacy.status, 204)
  assert.deepEqual(journalEvents.map(([event]) => event), ['response', 'finished'])
  assert.equal(recorderEvents[0][2].kind, 'network-response')
  assert.equal(recorderEvents[0][2].outcome, '204')
})

test('failed navigation records the failure and clears the pending navigation', () => {
  const handlers = new Map()
  const recorderEvents = []
  const frame = {}
  const request = {
    method: () => 'GET',
    resourceType: () => 'document',
    frame: () => frame,
    isNavigationRequest: () => true,
    failure: () => ({ errorText: 'net::ERR_FAILED' }),
  }
  const page = { on: (event, listener) => handlers.set(event, listener), mainFrame: () => frame }
  const session = { sessionId: 'session', key: 'session@1' }
  const view = { viewId: 'v1', documentGeneration: 2, navigationId: 'v1-n1', pendingNavigationId: 'v1-n2', network: [] }
  const journal = {
    requestNavigationId: () => 'v1-n2',
    recordRequestFailure: () => {},
    recordResponse: () => {},
    recordRequestFinished: () => {},
  }
  const recorder = { record: (...args) => recorderEvents.push(args) }

  bindPageNetworkEvents(page, session, view, new WeakMap(), journal, recorder, () => {})
  handlers.get('requestfailed')(request)

  assert.equal(view.pendingNavigationId, undefined)
  assert.equal(recorderEvents[0][2].kind, 'network-failure')
  assert.equal(recorderEvents[0][2].navigationId, 'v1-n2')
})

