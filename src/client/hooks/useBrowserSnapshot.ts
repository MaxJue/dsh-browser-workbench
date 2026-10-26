import { useEffect, useState } from 'react'
import type { BrowserFrameCursor, BrowserPanelSnapshot, BrowserPanelView, BrowserSplitViewPane } from '../../domain/protocol.ts'
import type { Port } from '../port.ts'
import { mergeSnapshotFrames } from '../utils/snapshot-merger.ts'

export function useBrowserSnapshot(sessionId: string, view: BrowserPanelView, port: Port) {
  const [snapshot, setSnapshot] = useState<BrowserPanelSnapshot>({
    available: false,
    sessionId,
    tabs: [],
    console: [],
    network: [],
  })
  const [error, setError] = useState<string>()

  useEffect(() => {
    let disposed = false
    let sequence = 0
    let activeViewId: string | undefined
    let streamGeneration = -1
    let viewportGeneration = -1
    const splitCursors: Partial<Record<BrowserSplitViewPane, BrowserFrameCursor>> = {}
    let diagnosticReadSequence = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let idleDelay = 50

    const refresh = async () => {
      let nextDelay = view === 'live' ? idleDelay : 500
      try {
        const next = await port.snapshot(
          sessionId,
          view,
          streamGeneration < 0 ? undefined : streamGeneration,
          sequence,
          splitCursors,
          undefined,
          view === 'diagnostic' ? diagnosticReadSequence : undefined,
        )
        if (disposed) return

        const receivedFrame = next.frame !== undefined || (next.splitView?.panes ?? []).some(item => item.frame !== undefined)
        if (view === 'live') {
          idleDelay = receivedFrame ? 50 : Math.min(Math.max(Math.round(idleDelay * 1.6), 50), 180)
          nextDelay = receivedFrame ? 33 : idleDelay
        }

        const viewChanged = next.activeViewId !== activeViewId
        const streamChanged = next.frame !== undefined && next.frame.streamGeneration !== streamGeneration
        const viewportChanged = next.liveView?.viewportGeneration !== viewportGeneration

        if (viewChanged) {
          activeViewId = next.activeViewId
          sequence = next.frame?.sequence ?? 0
        } else if (streamChanged || viewportChanged) {
          sequence = next.frame?.sequence ?? 0
        } else if (next.frame !== undefined) {
          sequence = next.frame.sequence
        }

        viewportGeneration = next.liveView?.viewportGeneration ?? -1
        if (next.frame !== undefined) streamGeneration = next.frame.streamGeneration
        for (const pane of next.splitView?.panes ?? []) {
          if (pane.frame !== undefined) {
            splitCursors[pane.pane] = {
              streamGeneration: pane.frame.streamGeneration,
              sequence: pane.frame.sequence,
            }
          }
        }

        if (view === 'diagnostic') {
          diagnosticReadSequence = next.diagnostic?.unread.latestSequence ?? diagnosticReadSequence
        }

        setSnapshot(previous => mergeSnapshotFrames(previous, next, view, viewChanged, streamChanged, viewportChanged))
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause))
          nextDelay = view === 'live' ? 180 : 500
        }
      } finally {
        if (!disposed) {
          timer = setTimeout(() => { void refresh() }, nextDelay)
        }
      }
    }

    void refresh()
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      void port.close(sessionId, view).catch(() => {})
    }
  }, [port, sessionId, view])

  const clearError = () => setError(undefined)

  return { snapshot, setSnapshot, error, setError, clearError }
}
