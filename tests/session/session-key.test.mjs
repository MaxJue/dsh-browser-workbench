import assert from 'node:assert/strict'
import test from 'node:test'
import { pendingSessionKey, sessionKey } from '../../src/session/session-key.ts'

test('creates stable keys from session identity', () => {
  assert.equal(sessionKey({ sessionId: 'session-1', sessionCreatedAt: 123 }), 'session-1@123')
  assert.equal(sessionKey({ sessionId: 'session-1', sessionCreatedAt: 0 }), 'session-1@0')
})

test('creates a distinct pending key before session creation metadata exists', () => {
  assert.equal(pendingSessionKey('session-1'), 'session-1@pending')
  assert.notEqual(pendingSessionKey('session-1'), sessionKey({ sessionId: 'session-1', sessionCreatedAt: 0 }))
})

