import type { BrowserPanelView } from '../domain/protocol.ts'

export interface PanelController {
  open(sessionId: string, view: BrowserPanelView): { ok: boolean; message?: string }
  close(sessionId?: string): void
  attach(sessionId: string, tabId: string, closeTab: () => void, openTab: (view: BrowserPanelView) => void): () => void
  update(sessionId: string, tabId: string, view: BrowserPanelView): void
  subscribe(sessionId: string, listener: (state: { open: boolean; view?: BrowserPanelView }) => void): () => void
  getSnapshot(sessionId: string): { open: boolean; view?: BrowserPanelView }
}

interface MountedTab {
  tabId: string
  view?: BrowserPanelView
  closeTab(): void
  openTab(view: BrowserPanelView): void
  token: object
}

export function createPanelController(openUnattached: (view: BrowserPanelView) => void): PanelController {
  const mountedTabs = new Map<string, MountedTab>()
  const listeners = new Map<string, Set<(state: { open: boolean; view?: BrowserPanelView }) => void>>()
  // useSyncExternalStore compares snapshots by identity, so a session must keep
  // returning the same object until its mount state really changes; a fresh
  // literal per read re-renders forever (React error #185).
  const closedSnapshot: { open: boolean; view?: BrowserPanelView } = Object.freeze({ open: false })
  const snapshots = new Map<string, { open: boolean; view?: BrowserPanelView }>()
  const snapshot = (sessionId: string): { open: boolean; view?: BrowserPanelView } => {
    const mounted = mountedTabs.get(sessionId)
    if (mounted === undefined) return closedSnapshot
    const previous = snapshots.get(sessionId)
    if (previous !== undefined && previous.view === mounted.view) return previous
    const next = Object.freeze({ open: true, view: mounted.view })
    snapshots.set(sessionId, next)
    return next
  }
  const notify = (sessionId: string) => {
    const state = snapshot(sessionId)
    for (const listener of listeners.get(sessionId) ?? []) listener(state)
  }

  return {
    open(sessionId, view) {
      try {
        const mounted = mountedTabs.get(sessionId)
        if (mounted === undefined) openUnattached(view)
        else mounted.openTab(view)
        return { ok: true }
      } catch (cause) {
        return { ok: false, message: cause instanceof Error ? cause.message : String(cause) }
      }
    },
    close(sessionId) {
      const targets = sessionId === undefined
        ? [...mountedTabs.entries()]
        : [...mountedTabs.entries()].filter(([mountedSessionId]) => mountedSessionId === sessionId)
      for (const [mountedSessionId, mounted] of targets) {
        mountedTabs.delete(mountedSessionId)
        mounted.closeTab()
        notify(mountedSessionId)
      }
    },
    attach(sessionId, tabId, closeTab, openTab) {
      const token = {}
      mountedTabs.set(sessionId, { tabId, closeTab, openTab, token })
      notify(sessionId)
      return () => {
        if (mountedTabs.get(sessionId)?.token !== token) return
        mountedTabs.delete(sessionId)
        notify(sessionId)
      }
    },
    update(sessionId, tabId, view) {
      const mounted = mountedTabs.get(sessionId)
      if (mounted === undefined || mounted.tabId !== tabId || mounted.view === view) return
      mounted.view = view
      notify(sessionId)
    },
    subscribe(sessionId, listener) {
      let sessionListeners = listeners.get(sessionId)
      if (sessionListeners === undefined) {
        sessionListeners = new Set()
        listeners.set(sessionId, sessionListeners)
      }
      sessionListeners.add(listener)
      // No synchronous listener(...) call here: useSyncExternalStore reads the snapshot
      // right after subscribing, and a notify-on-subscribe turns any re-subscribe into an
      // infinite render loop (React error #185) when the subscriber re-renders.
      return () => {
        sessionListeners?.delete(listener)
        if (sessionListeners?.size === 0) {
          listeners.delete(sessionId)
          snapshots.delete(sessionId)
        }
      }
    },
    getSnapshot: snapshot,
  }
}
