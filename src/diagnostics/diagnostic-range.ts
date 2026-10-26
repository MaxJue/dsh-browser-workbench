import { fail } from '../domain/errors.ts'
import type { BrowserDiagnoseInput } from '../domain/protocol.ts'
import type { SessionState, ViewState } from '../domain/types.ts'
import type { DebugSessionStore } from './debug-session-store.ts'
import type { EventJournal } from './event-journal.ts'

export function diagnosticRange(
  session: SessionState,
  view: ViewState,
  input: BrowserDiagnoseInput,
  defaultAfterSequence: number,
  journal: EventJournal,
  debugSessions: DebugSessionStore,
) {
  const starts = [
    input.sinceCursor === undefined ? undefined : 'cursor',
    input.sinceCheckpointId?.trim() ? 'checkpoint' : undefined,
    input.sinceActionId?.trim() ? 'action' : undefined,
  ].filter((value): value is string => value !== undefined)
  if (starts.length > 1) fail('INVALID_ARGS', 'browser_diagnose accepts only one of sinceCursor, sinceCheckpointId, or sinceActionId')
  let afterSequence = defaultAfterSequence
  let source: 'default' | 'cursor' | 'checkpoint' | 'action' = 'default'
  if (input.sinceCursor !== undefined) {
    if (!Number.isInteger(input.sinceCursor) || input.sinceCursor < 0) fail('INVALID_ARGS', 'browser_diagnose sinceCursor must be a non-negative integer')
    afterSequence = input.sinceCursor
    source = 'cursor'
  } else if (input.sinceCheckpointId?.trim()) {
    const checkpoint = debugSessions.checkpointById(session.key, input.sinceCheckpointId.trim())
    if (checkpoint === undefined) fail('INVALID_ARGS', 'browser_diagnose sinceCheckpointId does not exist in the current diagnose session')
    afterSequence = checkpoint.cursor.sequence
    source = 'checkpoint'
  } else if (input.sinceActionId?.trim()) {
    const action = journal.action(session.key, input.sinceActionId.trim())
    if (action === undefined || action.viewId !== view.viewId) fail('INVALID_ARGS', 'browser_diagnose sinceActionId does not exist for the current diagnose view')
    const relatedSequences = action.relatedEventIds.map(eventId => journal.event(session.key, eventId)?.sequence).filter((sequence): sequence is number => sequence !== undefined)
    afterSequence = Math.max(0, Math.min(action.sequence, ...relatedSequences) - 1)
    source = 'action'
  }
  let untilSequence: number | undefined
  const untilActionId = input.untilActionId?.trim()
  if (untilActionId !== undefined && untilActionId !== '') {
    const action = journal.action(session.key, untilActionId)
    if (action === undefined || action.viewId !== view.viewId) fail('INVALID_ARGS', 'browser_diagnose untilActionId does not exist for the current diagnose view')
    untilSequence = action.sequence
    if (untilSequence <= afterSequence) fail('INVALID_ARGS', 'browser_diagnose untilActionId must be after the selected range start')
  }
  const events = journal.events(session.key, afterSequence, view.viewId).filter(event => event.kind !== 'script'
    && event.contextGeneration === session.contextGeneration
    && (untilSequence === undefined || event.sequence <= untilSequence))
  return {
    events,
    range: {
      schemaVersion: 2 as const,
      source,
      afterSequence,
      ...(untilSequence === undefined ? {} : { untilSequence }),
      nextCursor: journal.cursor(session.key),
    },
  }
}
