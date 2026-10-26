import type { BrowserLiveViewMode, BrowserPanelView } from '../domain/protocol.ts'

export const LIVE_VIEW_PREFERENCE_KEY = 'dsh-browser-tools.live-view-mode'
export const panelViews: BrowserPanelView[] = ['live', 'diagnostic', 'console', 'network', 'debugger', 'performance', 'provider', 'extensions', 'emulation']

export function valueOf<T>(value: unknown): T {
  const result = value as { ok?: boolean; value?: T; error?: { message?: string } }
  if (result?.ok === true) return result.value as T
  throw new Error(result?.error?.message ?? 'browser panel request failed')
}

export function liveViewPreference(): BrowserLiveViewMode {
  try {
    return localStorage.getItem(LIVE_VIEW_PREFERENCE_KEY) === 'standard' ? 'standard' : 'adaptive'
  } catch {
    return 'adaptive'
  }
}

export function saveLiveViewPreference(mode: BrowserLiveViewMode): void {
  try {
    localStorage.setItem(LIVE_VIEW_PREFERENCE_KEY, mode)
  } catch {}
}

export function isBrowserPanelView(value: unknown): value is BrowserPanelView {
  return typeof value === 'string' && panelViews.includes(value as BrowserPanelView)
}
