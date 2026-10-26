import type { SessionState, ViewState } from '../domain/types.ts'
import type { ScriptBuildIdentity } from '../diagnostics/build-registry.ts'
import type { CdpContextAdapter } from '../diagnostics/cdp-context-adapter.ts'
import type { EventJournal } from '../diagnostics/event-journal.ts'
import { createCdpState, type CdpState } from './cdp-state.ts'
import type { RawCdpSession } from './cdp-raw.ts'
import { bindCdpDebuggerLifecycle, bindCdpTargetLifecycle } from './cdp-debugger-events.ts'
import { bindCdpScriptEvents } from './cdp-script-events.ts'
import { bindCdpFetchEvents } from './cdp-fetch-events.ts'
import { bindCdpProfileEvents } from './cdp-profile-events.ts'
import { bindCdpScreencastEvents } from './cdp-screencast-events.ts'

export interface CdpSessionDependencies {
  session: SessionState
  view: ViewState
  client: RawCdpSession
  journal: EventJournal
  interceptionTimeoutMs: number
  maxArtifactBytes: number
  createContextAdapter(session: SessionState, view: ViewState, client: RawCdpSession): CdpContextAdapter
  registerBuildScript(sessionKey: string, script: ScriptBuildIdentity): void
  deactivateExecutionContext(sessionKey: string, executionContextId: number): void
  deactivateTarget(sessionKey: string, targetId: string): void
  recorderStatus(session: SessionState): { mode: string; status: string }
  recordVisualFrame(session: SessionState, view: ViewState, state: CdpState, metadata: Record<string, unknown>): void
}

export function createBoundCdpState(dependencies: CdpSessionDependencies): CdpState {
  const { session, view, client } = dependencies
  const state = createCdpState(client as never, view.viewport.generation)
  state.contextAdapter = dependencies.createContextAdapter(session, view, client)
  bindCdpDebuggerLifecycle(client, state)
  bindCdpScriptEvents(client, session, view, state, dependencies.journal, {
    registerBuildScript: dependencies.registerBuildScript,
  })
  bindCdpTargetLifecycle(client, session, state, {
    deactivateExecutionContext: dependencies.deactivateExecutionContext,
    deactivateTarget: dependencies.deactivateTarget,
  })
  bindCdpScreencastEvents(client, state, session, view, {
    recorderStatus: dependencies.recorderStatus,
    recordVisualFrame: dependencies.recordVisualFrame,
  })
  bindCdpFetchEvents(client, state, dependencies.interceptionTimeoutMs)
  bindCdpProfileEvents(client, state, dependencies.maxArtifactBytes)
  return state
}
