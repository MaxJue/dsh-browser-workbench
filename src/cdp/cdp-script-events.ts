import type { SessionState, ViewState } from '../domain/types.ts'
import type { CdpState } from './cdp-state.ts'
import type { EventJournal } from '../diagnostics/event-journal.ts'
import { number, string, type RawCdpSession } from './cdp-raw.ts'

export interface CdpScriptEventDependencies {
  registerBuildScript: (sessionKey: string, script: {
    scriptId: string
    viewId: string
    documentGeneration: number
    navigationId: string
    url: string
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
    loadedAt: number
    active: boolean
    [identity: string]: unknown
  }) => void
}

export function bindCdpScriptEvents(
  client: RawCdpSession,
  session: SessionState,
  view: ViewState,
  state: CdpState,
  journal: EventJournal,
  dependencies: CdpScriptEventDependencies,
): void {
  client.on('Debugger.scriptParsed', payload => {
    const scriptId = string(payload.scriptId)
    if (scriptId === '') return
    const executionContextId = number(payload.executionContextId)
    const identity = executionContextId === 0 || state.contextAdapter?.isEnabled() !== true
      ? {}
      : state.contextAdapter.contextForExecution(executionContextId)
    const script = {
      scriptId,
      url: string(payload.url),
      startLine: number(payload.startLine),
      startColumn: number(payload.startColumn),
      endLine: number(payload.endLine),
      endColumn: number(payload.endColumn),
      ...(executionContextId === 0 ? {} : { executionContextId }),
      ...identity,
    }
    state.scripts.set(scriptId, script)
    dependencies.registerBuildScript(session.key, {
      scriptId,
      viewId: view.viewId,
      documentGeneration: view.documentGeneration,
      navigationId: view.navigationId,
      url: script.url,
      startLine: script.startLine,
      startColumn: script.startColumn,
      endLine: script.endLine,
      endColumn: script.endColumn,
      loadedAt: Date.now(),
      active: true,
      ...identity,
    })
    if (state.contextAdapter?.isEnabled()) state.contextAdapter.registerScript(script.url, identity)
    if (!state.contextAdapter?.isEnabled()) return
    journal.recordScript({
      sessionId: session.sessionId,
      sessionKey: session.key,
      viewId: view.viewId,
      contextGeneration: session.contextGeneration,
      documentGeneration: view.documentGeneration,
      navigationId: view.navigationId,
      ...identity,
      scriptId,
      url: script.url,
      ...(string(payload.sourceMapURL) === '' ? {} : { sourceMapUrl: string(payload.sourceMapURL) }),
      startLine: script.startLine,
      startColumn: script.startColumn,
      endLine: script.endLine,
      endColumn: script.endColumn,
    })
  })
}
