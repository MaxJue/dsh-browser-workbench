import assert from 'node:assert/strict'
import test from 'node:test'
import { inputTraceAction } from '../../src/input/input-actions.ts'

test('inputTraceAction classifies input events for diagnostics', () => {
  assert.equal(inputTraceAction({ action: 'insert_text' }), 'insert-text')
  assert.equal(inputTraceAction({ action: 'composition_commit' }), 'composition')
  assert.equal(inputTraceAction({ action: 'paste' }), 'paste')
  assert.equal(inputTraceAction({ action: 'key_press', composing: true }), 'composition')
  assert.equal(inputTraceAction({ action: 'key_press', composing: false }), 'key-press')
  assert.equal(inputTraceAction({ action: 'mouse_wheel' }), 'wheel')
  assert.equal(inputTraceAction({ action: 'mouse_move' }), 'pointer')
})

