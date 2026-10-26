import assert from 'node:assert/strict'
import test from 'node:test'
import { diagnosticRange } from '../../src/diagnostics/diagnostic-range.ts'

function setup() {
  const events = [
    { kind: 'console', sequence: 1, contextGeneration: 2, viewId: 'view-1' },
    { kind: 'script', sequence: 2, contextGeneration: 2, viewId: 'view-1' },
    { kind: 'network', sequence: 3, contextGeneration: 1, viewId: 'view-1' },
    { kind: 'action', sequence: 4, contextGeneration: 2, viewId: 'view-1', relatedEventIds: ['event-4'] },
    { kind: 'network', sequence: 5, contextGeneration: 2, viewId: 'view-1' },
    { kind: 'network', sequence: 6, contextGeneration: 2, viewId: 'view-2' },
  ]
  const journal = {
    event: (_session, id) => id === 'event-4' ? { sequence: 4 } : undefined,
    action: (_session, id) => id === 'action-1' ? events[3] : undefined,
    events: (_session, after, viewId) => events.filter(event => event.sequence > after && event.viewId === viewId),
    cursor: () => ({ sequence: 6 }),
  }
  const debugSessions = {
    checkpointById: (_session, id) => id === 'checkpoint-1' ? { cursor: { sequence: 3 } } : undefined,
  }
  const session = { key: 'session-1', contextGeneration: 2 }
  const view = { viewId: 'view-1' }
  return { journal, debugSessions, session, view }
}

test('filters scripts, stale context and other views while preserving range metadata', () => {
  const input = { action: 'report', sinceCursor: 0 }
  const { journal, debugSessions, session, view } = setup()
  const result = diagnosticRange(session, view, input, 0, journal, debugSessions)
  assert.deepEqual(result.events.map(event => event.sequence), [1, 4, 5])
  assert.deepEqual(result.range, { schemaVersion: 2, source: 'cursor', afterSequence: 0, nextCursor: { sequence: 6 } })
})

test('resolves checkpoint and action starts and supports an until action', () => {
  const { journal, debugSessions, session, view } = setup()
  const checkpoint = diagnosticRange(session, view, { action: 'report', sinceCheckpointId: 'checkpoint-1' }, 0, journal, debugSessions)
  assert.equal(checkpoint.range.afterSequence, 3)
  const action = diagnosticRange(session, view, { action: 'report', sinceActionId: 'action-1', untilActionId: 'action-1' }, 0, journal, debugSessions)
  assert.equal(action.range.afterSequence, 3)
  assert.equal(action.range.untilSequence, 4)
})

test('rejects conflicting or invalid range selectors', () => {
  const { journal, debugSessions, session, view } = setup()
  assert.throws(() => diagnosticRange(session, view, { action: 'report', sinceCursor: 1, sinceActionId: 'action-1' }, 0, journal, debugSessions), /only one/)
  assert.throws(() => diagnosticRange(session, view, { action: 'report', sinceCursor: -1 }, 0, journal, debugSessions), /non-negative integer/)
  assert.throws(() => diagnosticRange(session, view, { action: 'report', sinceCheckpointId: 'missing' }, 0, journal, debugSessions), /does not exist/)
})
