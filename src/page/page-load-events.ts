import type { Page } from 'playwright-core'
import type { SessionState, ViewState } from '../domain/types.ts'

export function bindPageLoadEvents(
  page: Page,
  session: SessionState,
  view: ViewState,
  queueSession: (session: SessionState, operation: () => Promise<void>) => Promise<void>,
  applyLiveViewport: (session: SessionState, view: ViewState) => Promise<void>,
): void {
  page.on('load', () => {
    if (view.kind !== 'page' || session.liveView.mode !== 'adaptive' || page.isClosed()) return
    void queueSession(session, () => applyLiveViewport(session, view)).catch(() => {})
  })
}
