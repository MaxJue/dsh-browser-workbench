import type { SessionState, ViewState } from '../domain/types.ts'
import type { BrowserSplitViewPane } from '../domain/protocol.ts'

export interface LiveViewportDependencies {
  splitPaneForView: (session: SessionState, viewId: string) => BrowserSplitViewPane | undefined
  liveViewport: (session: SessionState) => { width: number; height: number }
  setViewViewport: (session: SessionState, view: ViewState, width: number, height: number) => Promise<void>
  applyAdaptiveFit: (session: SessionState, view: ViewState) => Promise<void>
  clearAdaptiveFit: (view: ViewState) => Promise<void>
}

export async function applyLiveViewport(session: SessionState, view: ViewState, dependencies: LiveViewportDependencies): Promise<void> {
  const pane = dependencies.splitPaneForView(session, view.viewId)
  const paneSize = pane === undefined ? undefined : session.splitView.panes[pane]
  if (session.liveView.mode === 'adaptive' && pane !== undefined && (paneSize?.adaptiveWidth === undefined || paneSize.adaptiveHeight === undefined)) return
  const viewport = session.liveView.mode === 'adaptive' && paneSize?.adaptiveWidth !== undefined && paneSize.adaptiveHeight !== undefined
    ? { width: paneSize.adaptiveWidth, height: paneSize.adaptiveHeight }
    : dependencies.liveViewport(session)
  await dependencies.setViewViewport(session, view, viewport.width, viewport.height)
  if (session.liveView.mode === 'adaptive') await dependencies.applyAdaptiveFit(session, view)
  else await dependencies.clearAdaptiveFit(view)
}

export async function applyVisibleLiveViewports(
  session: SessionState,
  visibleViewIds: Set<string>,
  views: Map<string, ViewState>,
  dependencies: LiveViewportDependencies,
): Promise<void> {
  await Promise.all([...visibleViewIds].map(async viewId => {
    const view = views.get(viewId)
    if (view !== undefined && !view.page.isClosed()) await applyLiveViewport(session, view, dependencies)
  }))
}
