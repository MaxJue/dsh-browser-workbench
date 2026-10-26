import { fail } from '../domain/errors.ts'
import type { SessionState, ToolOutput, ViewState } from '../domain/types.ts'

function asData(value: unknown): ToolOutput['data'] {
  return value as ToolOutput['data']
}

export function resolveView(session: SessionState, viewId?: string): ViewState {
  const id = viewId?.trim() || session.activeViewId
  const view = session.views.get(id)
  if (view === undefined || view.page.isClosed()) fail('UNKNOWN_VIEW', `browser view ${JSON.stringify(id)} does not exist`)
  if (view.kind === 'page') session.activeViewId = view.viewId
  return view
}

export function resolveViewByInput(session: SessionState, viewId?: string, index?: number): ViewState {
  if (viewId !== undefined && viewId.trim() !== '') return resolveView(session, viewId)
  if (index !== undefined) {
    const view = [...session.views.values()].filter(item => item.kind === 'page')[index]
    if (view === undefined || view.page.isClosed()) fail('UNKNOWN_VIEW', `browser tab index ${String(index)} does not exist; call browser_tabs with action list`)
    session.activeViewId = view.viewId
    return view
  }
  return resolveView(session)
}

export function debuggerPauseResponse(view: ViewState, action: string): ToolOutput | undefined {
  if (view.cdp?.paused !== true) return undefined
  return { ok: false, action, viewId: view.viewId, data: asData({ code: 'DEBUGGER_PAUSED', recoverable: true, message: 'The page is paused in the JavaScript debugger.', next: { tool: 'browser_debugger', arguments: { action: 'resume', viewId: view.viewId } } }) }
}

export function staleReferenceResponse(view: ViewState, action: string): ToolOutput {
  return { ok: false, action, viewId: view.viewId, data: asData({ code: 'STALE_REF', recoverable: true, message: 'The page changed after the snapshot; the element ref is no longer valid.', next: { tool: 'browser_snapshot', arguments: { viewId: view.viewId, includeDiff: true } } }) }
}

export function resolveRef(view: ViewState, value: string) {
  const ref = view.refs.get(value)
  if (ref === undefined || ref.documentGeneration !== view.documentGeneration || ref.snapshotGeneration !== view.snapshotGeneration) {
    fail('STALE_REF', `browser ref ${JSON.stringify(value)} is stale; take a new snapshot`)
  }
  return ref.handle
}
