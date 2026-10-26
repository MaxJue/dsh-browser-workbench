import type { BrowserDiagnoseInput } from '../domain/protocol.ts'
import type { SessionState, ToolOutput, ViewState } from '../domain/types.ts'
import { fail } from '../domain/errors.ts'
import type { DebugSessionStore } from './debug-session-store.ts'
import type { ContextIdentityRegistry } from './context-registry.ts'
import type { JournalCursor } from './event-journal.ts'

export interface DiagnosticLifecycleDependencies {
  session: SessionState
  input: BrowserDiagnoseInput
  debugSessions: DebugSessionStore
  contextIdentities: ContextIdentityRegistry
  view(session: SessionState, viewId?: string): ViewState
  ensureContextIdentity(session: SessionState, view: ViewState): Promise<NonNullable<ViewState['cdp']>>
  refreshApplications(session: SessionState, view: ViewState): Promise<unknown[]>
  diagnosticContext(session: SessionState, view: ViewState, debugSession: ReturnType<DebugSessionStore['require']>): unknown
  checkpointCursor(sessionKey: string): number
  buildTopology(sessionKey: string): unknown
  applicationTopology(sessionKey: string): { truncated: boolean }
  journalCursor(sessionKey: string): JournalCursor
}

function asData(value: unknown): ToolOutput['data'] {
  return value as ToolOutput['data']
}

export async function diagnosticLifecycleAction(dependencies: DiagnosticLifecycleDependencies): Promise<ToolOutput | undefined> {
  const { session, input, debugSessions } = dependencies
  if (input.action === 'start') {
    const view = dependencies.view(session, input.viewId)
    await dependencies.ensureContextIdentity(session, view)
    const applications = await dependencies.refreshApplications(session, view)
    const existing = debugSessions.get(session.key)
    if (existing !== undefined && existing.viewId !== view.viewId) {
      fail('INVALID_ARGS', `browser diagnose session is already bound to view ${existing.viewId}; stop it before starting on another view`)
    }
    if (existing === undefined) {
      session.diagnosticPanel.latestInspect = undefined
      session.diagnosticPanel.latestComparison = undefined
      session.diagnosticPanel.latestIncident = undefined
      session.diagnosticPanel.latestTakeoverSummary = undefined
    }
    const debugSession = debugSessions.start({
      sessionKey: session.key,
      dshSessionId: session.sessionId,
      viewId: view.viewId,
      contextGeneration: session.contextGeneration,
      documentGeneration: view.documentGeneration,
      navigationId: view.navigationId,
      ...(view.cdp?.contextAdapter?.isEnabled() ? view.cdp.contextAdapter.mainContext() : {}),
      startedAt: Date.now(),
      startedCursor: dependencies.journalCursor(session.key),
    })
    return { ok: true, action: 'diagnose_start', viewId: view.viewId, data: asData({ debugSessionId: debugSession.debugSessionId, viewId: view.viewId, contextGeneration: session.contextGeneration, documentGeneration: view.documentGeneration, startedCursor: debugSession.startedCursor.sequence, diagnosticContext: dependencies.diagnosticContext(session, view, debugSession), contextTopology: view.cdp?.contextAdapter?.snapshot(), buildTopology: dependencies.buildTopology(session.key), applicationTopology: { applications, truncated: dependencies.applicationTopology(session.key).truncated } }) }
  }
  if (input.action === 'status') {
    const debugSession = debugSessions.get(session.key)
    if (debugSession === undefined) return { ok: true, action: 'diagnose_status', viewId: session.activeViewId, data: asData({ active: false, schemaVersion: 2 }) }
    const view = session.views.get(debugSession.viewId)
    if (view === undefined || view.page.isClosed() || debugSession.contextGeneration !== session.contextGeneration) {
      debugSessions.invalidate(session.key)
      return { ok: true, action: 'diagnose_status', viewId: session.activeViewId, data: asData({ active: false, schemaVersion: 2, previousDebugSessionId: debugSession.debugSessionId, status: 'invalidated' }) }
    }
    const applications = await dependencies.refreshApplications(session, view)
    return { ok: true, action: 'diagnose_status', viewId: view.viewId, data: asData({ active: true, diagnosticContext: dependencies.diagnosticContext(session, view, debugSession), contextTopology: view.cdp?.contextAdapter?.snapshot(), buildTopology: dependencies.buildTopology(session.key), applicationTopology: { applications, truncated: dependencies.applicationTopology(session.key).truncated }, startedAt: debugSession.startedAt, startedCursor: debugSession.startedCursor, checkpointCount: debugSession.checkpoints.size, cursor: dependencies.journalCursor(session.key) }) }
  }
  if (input.action === 'stop') {
    const stopped = debugSessions.stop(session.key)
    if (stopped !== undefined) {
      const state = session.views.get(stopped.viewId)?.cdp
      state?.contextAdapter?.dispose()
      if (state !== undefined) state.contextAdapter = undefined
      dependencies.contextIdentities.invalidateSession(session.key, session.contextGeneration)
    }
    return { ok: true, action: 'diagnose_stop', viewId: stopped?.viewId ?? session.activeViewId, data: asData({ stopped: stopped !== undefined, schemaVersion: 2, cleanup: { status: 'clean', debugSessionStore: 'clean', checkpointStore: 'clean', journal: 'retained-by-browser-session', browserResources: 'managed-by-runtime' }, ...(stopped === undefined ? {} : { debugSessionId: stopped.debugSessionId, status: stopped.status, cursor: dependencies.journalCursor(session.key) }) }) }
  }
  return undefined
}
