import assert from 'node:assert/strict'
import test from 'node:test'
import { ContextIdentityRegistry } from '../../src/diagnostics/context-registry.ts'

function started() {
  const registry = new ContextIdentityRegistry()
  registry.startSession('session-1', 'session-key', 1)
  return registry
}

test('resolves the main frame identity of an active session', () => {
  const registry = started()
  registry.upsertFrame({
    sessionKey: 'session-key',
    viewId: 'v1',
    frameId: 'F1',
    targetId: 'T1',
    mainFrame: true,
    url: 'https://example.test/',
    loaderId: 'L1',
    documentCommitted: true,
  })
  assert.deepEqual(registry.frameContext('session-key', 'F1'), {
    targetId: 'T1',
    frameId: 'F1',
    frameDocumentGeneration: 1,
    loaderId: 'L1',
  })
})

// CDP listeners can fire after the session was invalidated; a missing topology
// must read as "identity unknown" instead of throwing through the listener.
test('reads return no identity for an unknown session', () => {
  const registry = started()
  assert.deepEqual(registry.frameContext('missing-key', 'F1'), {})
  assert.deepEqual(registry.uniqueFrameContext('missing-key', 'v1', 'https://example.test/'), {})
  assert.deepEqual(registry.executionContext('missing-key', 7), {})
})

test('reads return no identity after the session was invalidated', () => {
  const registry = started()
  registry.upsertFrame({
    sessionKey: 'session-key',
    viewId: 'v1',
    frameId: 'F1',
    targetId: 'T1',
    mainFrame: true,
    url: 'https://example.test/',
    loaderId: 'L1',
    documentCommitted: true,
  })
  registry.invalidateSession('session-key')
  assert.deepEqual(registry.frameContext('session-key', 'F1'), {})
  assert.deepEqual(registry.executionContext('session-key', 7), {})
})

test('mutations still reject an unknown session', () => {
  const registry = started()
  assert.throws(() => registry.upsertTarget('missing-key', {
    targetId: 'T1',
    viewId: 'v1',
    type: 'page',
    browserContextGeneration: 1,
    url: 'https://example.test/',
    attached: true,
    owner: 'external',
    confidence: 'confirmed',
  }), /context identity session is not active/)
})
