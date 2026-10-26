import type { BrowserSplitViewPane } from '../domain/protocol.ts'
import type { SessionState, ViewState } from '../domain/types.ts'
import { STANDARD_VIEWPORT } from './viewport.ts'

export function liveViewport(session: SessionState): { width: number; height: number } {
  if (session.liveView.mode === 'standard') return { width: session.liveView.fixedWidth, height: session.liveView.fixedHeight }
  if (session.liveView.adaptiveWidth === undefined || session.liveView.adaptiveHeight === undefined) return STANDARD_VIEWPORT
  return { width: session.liveView.adaptiveWidth, height: session.liveView.adaptiveHeight }
}

export function splitPaneView(session: SessionState, pane: BrowserSplitViewPane): ViewState | undefined {
  const viewId = pane === 'top' ? session.splitView.topViewId : session.splitView.bottomViewId
  const view = viewId === undefined ? undefined : session.views.get(viewId)
  return view === undefined || view.page.isClosed() ? undefined : view
}

export function visibleViewIds(session: SessionState): Set<string> {
  const visible = session.splitView.enabled
    ? new Set([session.splitView.topViewId, session.splitView.bottomViewId].filter((value): value is string => value !== undefined))
    : new Set(session.activeViewId === '' ? [] : [session.activeViewId])
  if (session.extensionPopup !== undefined) visible.add(session.extensionPopup.view.viewId)
  return visible
}

export function splitPaneForView(session: SessionState, viewId: string): BrowserSplitViewPane | undefined {
  if (!session.splitView.enabled) return undefined
  if (session.splitView.topViewId === viewId) return 'top'
  if (session.splitView.bottomViewId === viewId) return 'bottom'
  return undefined
}

export function splitSnapshot(session: SessionState) {
  return {
    enabled: session.splitView.enabled,
    focusedPane: session.splitView.focusedPane,
    orientation: session.splitView.orientation,
    ratio: session.splitView.ratio,
    changedAt: session.splitView.changedAt,
    ...(session.splitView.topViewId === undefined ? {} : { topViewId: session.splitView.topViewId }),
    ...(session.splitView.bottomViewId === undefined ? {} : { bottomViewId: session.splitView.bottomViewId }),
  }
}
