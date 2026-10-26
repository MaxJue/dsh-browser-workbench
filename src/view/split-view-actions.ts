import type { Page } from 'playwright-core'
import type { BrowserSplitViewInput, BrowserSplitViewPane } from '../domain/protocol.ts'
import type { SessionState, ViewState } from '../domain/types.ts'
import { fail } from '../domain/errors.ts'
import { normalizeAdaptiveViewport, MIN_SPLIT_ADAPTIVE_VIEWPORT } from './viewport.ts'

export interface SplitViewActionDependencies {
  createPage: (session: SessionState) => Promise<Page>
  bindView: (session: SessionState, page: Page) => ViewState
  splitPaneView: (session: SessionState, pane: BrowserSplitViewPane) => ViewState | undefined
  resolveView: (session: SessionState, viewId: string) => ViewState
  savePreference: (sessionId: string, preference: { ratio: number; orientation: 'top-bottom' | 'left-right' }) => Promise<void>
  applyLiveViewport: (session: SessionState, view: ViewState) => Promise<void>
}

export async function mutateSplitView(session: SessionState, input: BrowserSplitViewInput, dependencies: SplitViewActionDependencies): Promise<{ status: boolean; noActive: boolean; changed: boolean; viewId?: string }> {
  const current = session.views.get(session.activeViewId) ?? [...session.views.values()].find(view => view.kind === 'page' && !view.page.isClosed())
  if (input.action === 'status') return { status: true, noActive: false, changed: false, viewId: current?.viewId }
  if (current === undefined) return { status: false, noActive: true, changed: false }
  let changed = false

  if (input.action === 'open') {
    let second = [...session.views.values()].find(view => view.kind === 'page' && !view.page.isClosed() && view.viewId !== current.viewId)
    if (second === undefined) second = dependencies.bindView(session, await dependencies.createPage(session))
    if (input.orientation === 'top-bottom' || input.orientation === 'left-right') session.splitView.orientation = input.orientation
    session.splitView.panes.top = {}
    session.splitView.panes.bottom = {}
    session.splitView.enabled = true
    session.splitView.topViewId = current.viewId
    session.splitView.bottomViewId = second.viewId
    session.splitView.focusedPane = 'top'
    session.activeViewId = current.viewId
    if (input.orientation === 'top-bottom' || input.orientation === 'left-right') await dependencies.savePreference(session.sessionId, { ratio: session.splitView.ratio, orientation: session.splitView.orientation })
    changed = true
  } else if (input.action === 'close') {
    if (session.splitView.enabled) {
      const focused = dependencies.splitPaneView(session, session.splitView.focusedPane) ?? current
      session.splitView.enabled = false
      session.splitView.topViewId = undefined
      session.splitView.bottomViewId = undefined
      session.activeViewId = focused.viewId
      changed = true
    }
  } else if (input.action === 'swap') {
    if (!session.splitView.enabled) fail('INVALID_ARGS', 'split view is not open')
    const top = session.splitView.topViewId
    session.splitView.topViewId = session.splitView.bottomViewId
    session.splitView.bottomViewId = top
    session.splitView.focusedPane = session.splitView.focusedPane === 'top' ? 'bottom' : 'top'
    changed = true
  } else if (input.action === 'assign') {
    if (!session.splitView.enabled || input.pane === undefined || input.viewId === undefined) fail('INVALID_ARGS', 'split assign requires an open split, pane, and viewId')
    const target = dependencies.resolveView(session, input.viewId)
    const otherPane: BrowserSplitViewPane = input.pane === 'top' ? 'bottom' : 'top'
    const other = dependencies.splitPaneView(session, otherPane)
    if (other?.viewId === target.viewId) session.splitView.focusedPane = otherPane
    else if (input.pane === 'top') session.splitView.topViewId = target.viewId
    else session.splitView.bottomViewId = target.viewId
    if (other?.viewId !== target.viewId) session.splitView.focusedPane = input.pane
    session.activeViewId = target.viewId
    changed = true
  } else if (input.action === 'focus') {
    if (!session.splitView.enabled || input.pane === undefined) fail('INVALID_ARGS', 'split focus requires an open split and pane')
    const target = dependencies.splitPaneView(session, input.pane)
    if (target === undefined) fail('UNKNOWN_VIEW', 'split pane does not contain a live tab')
    changed = session.splitView.focusedPane !== input.pane
    session.splitView.focusedPane = input.pane
    session.activeViewId = target.viewId
    await target.page.bringToFront()
  } else if (input.action === 'ratio') {
    if (!session.splitView.enabled || input.ratio === undefined || !Number.isFinite(input.ratio)) fail('INVALID_ARGS', 'split ratio requires an open split and finite ratio')
    const ratio = Math.min(Math.max(input.ratio, 0.4), 0.6)
    changed = session.splitView.ratio !== ratio
    session.splitView.ratio = ratio
    if (changed) await dependencies.savePreference(session.sessionId, { ratio, orientation: session.splitView.orientation })
  } else if (input.action === 'orientation') {
    if (!session.splitView.enabled || (input.orientation !== 'top-bottom' && input.orientation !== 'left-right')) fail('INVALID_ARGS', 'split orientation requires an open split and valid orientation')
    changed = session.splitView.orientation !== input.orientation
    session.splitView.orientation = input.orientation
    if (changed) {
      session.splitView.panes.top = {}
      session.splitView.panes.bottom = {}
      await dependencies.savePreference(session.sessionId, { ratio: session.splitView.ratio, orientation: input.orientation })
    }
  } else if (input.action === 'resize') {
    if (!session.splitView.enabled || input.pane === undefined || input.width === undefined || input.height === undefined) fail('INVALID_ARGS', 'split resize requires pane, width, and height')
    const target = dependencies.splitPaneView(session, input.pane)
    if (target === undefined) fail('UNKNOWN_VIEW', 'split pane does not contain a live tab')
    const viewport = normalizeAdaptiveViewport(input.width, input.height, MIN_SPLIT_ADAPTIVE_VIEWPORT)
    const pane = session.splitView.panes[input.pane]
    changed = pane.adaptiveWidth !== viewport.width || pane.adaptiveHeight !== viewport.height
    pane.adaptiveWidth = viewport.width
    pane.adaptiveHeight = viewport.height
    if (changed && session.liveView.mode === 'adaptive') await dependencies.applyLiveViewport(session, target)
  } else fail('INVALID_ARGS', `unknown browser_split_view action ${JSON.stringify(input.action)}`)

  if (changed) session.splitView.changedAt = Date.now()
  return { status: false, noActive: false, changed, viewId: session.activeViewId }
}
