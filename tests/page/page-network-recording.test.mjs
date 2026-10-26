import assert from 'node:assert/strict'
import test from 'node:test'
import { recordPageRequest } from '../../src/page/page-network-recording.ts'

test('page requests record bounded safe summaries and navigation identity', () => {
  const frame = {}
  const page = { mainFrame: () => frame }
  const request = {
    method: () => 'GET',
    url: () => 'https://example.test/?token=secret',
    resourceType: () => 'document',
    isNavigationRequest: () => true,
    frame: () => frame,
    redirectedFrom: () => null,
  }
  const session = { sessionId: 'session', key: 'session@1', contextGeneration: 3 }
  const view = {
    page,
    viewId: 'v1',
    navigationId: 'v1-n2',
    navigationGeneration: 2,
    documentGeneration: 4,
    pendingNavigationId: undefined,
    network: [],
  }
  const legacyRequests = new WeakMap()
  const journalEvents = []

  recordPageRequest(session, view, request, legacyRequests, { startNetwork: event => journalEvents.push(event) })

  assert.equal(view.pendingNavigationId, 'v1-n3')
  assert.equal(view.network[0].url, 'https://example.test/?token=%5BREDACTED%5D')
  assert.equal(legacyRequests.get(request), view.network[0])
  assert.equal(journalEvents[0].navigationId, 'v1-n3')
  assert.equal(journalEvents[0].contextGeneration, 3)
})

