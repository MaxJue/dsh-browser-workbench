import assert from 'node:assert/strict'
import test from 'node:test'
import { assertLosslessJson, findLosslessJsonViolation } from '../../src/diagnostics/lossless-json.ts'

test('accepts nested lossless JSON values', () => {
  assert.equal(findLosslessJsonViolation({ items: [null, true, 2, 'ok'] }), undefined)
  assert.doesNotThrow(() => assertLosslessJson({ safe: { value: 1 } }))
})

test('reports paths for unsupported values and non-finite numbers', () => {
  assert.equal(findLosslessJsonViolation({ result: undefined }), 'data.result contains undefined')
  assert.equal(findLosslessJsonViolation({ result: Number.NaN }), 'data.result contains a non-finite number')
  assert.equal(findLosslessJsonViolation({ result: -0 }), 'data.result contains -0')
  assert.throws(() => assertLosslessJson({ result: undefined }), /data\.result contains undefined/)
})

test('rejects cycles, sparse arrays and non-plain objects', () => {
  const cycle = {}
  cycle.self = cycle
  assert.match(findLosslessJsonViolation(cycle), /circular reference/)
  assert.match(findLosslessJsonViolation([,]), /sparse/)
  assert.match(findLosslessJsonViolation(new Date()), /plain object/)
})
