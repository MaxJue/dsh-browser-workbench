import assert from 'node:assert/strict'
import test from 'node:test'
import { number, record, string } from '../../src/cdp/cdp-raw.ts'

test('coerces untrusted CDP payload primitives conservatively', () => {
  assert.equal(number(12.5), 12.5)
  assert.equal(number(Number.NaN), 0)
  assert.equal(number('12'), 0)
  assert.equal(string('value'), 'value')
  assert.equal(string(12), '')
  assert.deepEqual(record({ value: true }), { value: true })
  assert.deepEqual(record(null), {})
  assert.deepEqual(record('value'), {})
})

