import type { ViewState } from '../domain/types.ts'

export interface NavigationCommit {
  navigationId: string
  documentGeneration: number
}

export function commitMainFrameNavigation(view: ViewState): NavigationCommit {
  if (view.pendingNavigationId === undefined) {
    view.navigationGeneration += 1
    view.navigationId = `${view.viewId}-n${view.navigationGeneration}`
  } else {
    view.navigationId = view.pendingNavigationId
    view.pendingNavigationId = undefined
  }
  view.documentGeneration += 1
  view.viewport.generation += 1
  view.viewport.contentWidth = view.viewport.width
  view.viewport.fittedWidth = view.viewport.width
  view.viewport.reflowedElements = 0
  view.viewport.fitDocumentGeneration = -1
  if (view.cdp !== undefined) view.cdp.latestFrame = undefined
  view.lastSnapshot = undefined
  return { navigationId: view.navigationId, documentGeneration: view.documentGeneration }
}

/**
 * True for a Playwright navigation timeout, which `page.goBack()` reports when a
 * same-document history restore (bfcache) completes without ever firing
 * `domcontentloaded`. Callers must still confirm the URL actually moved.
 */
export function isNavigationTimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { name } = error as { name?: unknown }
  return name === 'TimeoutError'
}
