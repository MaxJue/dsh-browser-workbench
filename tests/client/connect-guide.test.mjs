import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_CDP_ENDPOINT, connectionErrorMessage, normalizeCdpEndpoint } from '../../src/client/connect-guide.ts'

test('normalizes the default CDP endpoint without scanning ports', () => {
  assert.equal(DEFAULT_CDP_ENDPOINT, 'http://127.0.0.1:9222')
  assert.equal(normalizeCdpEndpoint('127.0.0.1:9222/'), DEFAULT_CDP_ENDPOINT)
  assert.equal(normalizeCdpEndpoint(' http://127.0.0.1:9222/?ignored=1 '), DEFAULT_CDP_ENDPOINT)
  assert.equal(normalizeCdpEndpoint(''), DEFAULT_CDP_ENDPOINT)
})

test('rejects unsupported CDP protocols and gives actionable connection errors', () => {
  assert.throws(() => normalizeCdpEndpoint('ws://127.0.0.1:9222'), /http 或 https/)
  assert.match(connectionErrorMessage(new Error('connect ECONNREFUSED 127.0.0.1:9222')), /远程调试端口 9222/)
  assert.match(connectionErrorMessage(new Error('unexpected protocol')), /unexpected protocol/)
})
