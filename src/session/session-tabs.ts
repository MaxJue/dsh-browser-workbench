import type { BrowserSplitViewPane } from '../domain/protocol.ts'
import type { ResolvedConfig, SessionState } from '../domain/types.ts'
import { assertUrlAllowed } from '../domain/policy.ts'

export interface RestorableTabs {
  urls: string[]
  activeIndex: number
  split?: {
    topIndex: number
    bottomIndex: number
    focusedPane: BrowserSplitViewPane
    orientation: 'top-bottom' | 'left-right'
    ratio: number
  }
}

export function restorableTabs(session: SessionState, config: ResolvedConfig): RestorableTabs {
  const views = [...session.views.values()].filter(view => view.kind === 'page' && !view.page.isClosed())
  const urls = views.map(view => {
    const url = view.page.url()
    if (url === 'about:blank') return url
    try {
      return assertUrlAllowed(config, url).href
    } catch {
      return 'about:blank'
    }
  })
  const activeIndex = Math.max(0, views.findIndex(view => view.viewId === session.activeViewId))
  const topIndex = views.findIndex(view => view.viewId === session.splitView.topViewId)
  const bottomIndex = views.findIndex(view => view.viewId === session.splitView.bottomViewId)
  return {
    urls: urls.length === 0 ? ['about:blank'] : urls,
    activeIndex,
    ...(session.splitView.enabled && topIndex >= 0 && bottomIndex >= 0 && topIndex !== bottomIndex
      ? { split: { topIndex, bottomIndex, focusedPane: session.splitView.focusedPane, orientation: session.splitView.orientation, ratio: session.splitView.ratio } }
      : {}),
  }
}
