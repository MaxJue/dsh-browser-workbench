import type { Page } from 'playwright-core'
import type { SessionState, ViewState } from '../domain/types.ts'
import type { BrowserSplitViewPane } from '../domain/protocol.ts'
import { rawCdp } from '../cdp/cdp-raw.ts'

export interface PageCloseDependencies {
  releaseViewRefs: (view: ViewState) => Promise<void>
  removeContextIdentity: (sessionKey: string, viewId: string) => void
  deactivateView: (sessionKey: string, viewId: string) => void
  invalidateDebugger: (sessionKey: string, viewId: string) => void
  splitPaneForView: (session: SessionState, viewId: string) => BrowserSplitViewPane | undefined
  splitPaneView: (session: SessionState, pane: BrowserSplitViewPane) => ViewState | undefined
  applyLiveViewport: (session: SessionState, view: ViewState) => Promise<void>
  queueSession: (session: SessionState, operation: () => Promise<void>) => Promise<void>
  syncScreencasts: (session: SessionState) => Promise<void>
}

export function bindPageCloseEvents(page: Page, session: SessionState, view: ViewState, dependencies: PageCloseDependencies): void {
  page.on('close', () => handlePageClose(session, view, dependencies))
}

export function handlePageClose(session: SessionState, view: ViewState, dependencies: PageCloseDependencies): void {
  if (view.kind === 'extension-popup') {
    void dependencies.releaseViewRefs(view)
    dependencies.removeContextIdentity(session.key, view.viewId)
    disposeViewCdp(view, false)
    session.views.delete(view.viewId)
    dependencies.deactivateView(session.key, view.viewId)
    dependencies.invalidateDebugger(session.key, view.viewId)
    if (session.extensionPopup?.view === view) session.extensionPopup = undefined
    return
  }

  const splitPane = dependencies.splitPaneForView(session, view.viewId)
  const splitOther = splitPane === undefined
    ? undefined
    : dependencies.splitPaneView(session, splitPane === 'top' ? 'bottom' : 'top')
  void dependencies.releaseViewRefs(view)
  dependencies.removeContextIdentity(session.key, view.viewId)
  disposeViewCdp(view, true)
  session.views.delete(view.viewId)
  dependencies.deactivateView(session.key, view.viewId)
  dependencies.invalidateDebugger(session.key, view.viewId)

  if (splitPane !== undefined) {
    session.splitView.enabled = false
    session.splitView.topViewId = undefined
    session.splitView.bottomViewId = undefined
    session.splitView.changedAt = Date.now()
    session.activeViewId = splitOther?.viewId ?? ''
  }
  if (session.activeViewId === view.viewId) {
    const next = [...session.views.values()].find(item => item.kind === 'page' && !item.page.isClosed())
    session.activeViewId = next?.viewId ?? ''
    if (next !== undefined) {
      void next.page.bringToFront().catch(() => {})
      void dependencies.applyLiveViewport(session, next).catch(() => {})
    }
  }
  void dependencies.queueSession(session, () => dependencies.syncScreencasts(session)).catch(() => {})
}

function disposeViewCdp(view: ViewState, continuePausedRequests: boolean): void {
  const cdp = view.cdp
  cdp?.screencastConsumers.clear()
  cdp?.contextAdapter?.dispose()
  view.cdp = undefined
  if (cdp === undefined) return
  if (continuePausedRequests) {
    for (const paused of cdp.pausedRequests.values()) {
      clearTimeout(paused.timer)
      void rawCdp(cdp.session).send('Fetch.continueRequest', { requestId: paused.requestId }).catch(() => {})
    }
    cdp.pausedRequests.clear()
  }
  void rawCdp(cdp.session).detach().catch(() => {})
}
