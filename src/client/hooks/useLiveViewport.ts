import { useEffect, useRef } from 'react'
import type { BrowserLiveViewInput, BrowserPanelSnapshot, BrowserPanelView, BrowserSplitViewInput, BrowserSplitViewPane } from '../../domain/protocol.ts'
import { liveViewPreference } from '../panel-model.ts'

export function useLiveViewport(
  sessionId: string,
  view: BrowserPanelView,
  snapshot: BrowserPanelSnapshot,
  splitRatio: number,
  runLiveView: (input: BrowserLiveViewInput) => Promise<unknown>,
  runSplitView: (input: BrowserSplitViewInput) => Promise<unknown>,
) {
  const liveCanvasRef = useRef<HTMLDivElement>(null)
  const topCanvasRef = useRef<HTMLDivElement>(null)
  const bottomCanvasRef = useRef<HTMLDivElement>(null)
  const liveViewInitializedSessionRef = useRef<string | undefined>(undefined)

  const splitOrientation = snapshot.splitView?.orientation ?? 'top-bottom'

  useEffect(() => {
    if (view !== 'live' || !snapshot.available) return
    const hostRatio = snapshot.splitView?.ratio ?? 0.5
    if (snapshot.splitView?.enabled && Math.abs(splitRatio - hostRatio) > 0.001) return

    const canvases = snapshot.splitView?.enabled
      ? [
          { pane: 'top' as const, element: topCanvasRef.current },
          { pane: 'bottom' as const, element: bottomCanvasRef.current },
        ]
      : [{ pane: undefined, element: liveCanvasRef.current }]

    if (canvases.some(item => item.element === null)) return

    if (snapshot.liveView?.initialized === true) {
      liveViewInitializedSessionRef.current = sessionId
    } else if (liveViewInitializedSessionRef.current !== sessionId) {
      liveViewInitializedSessionRef.current = undefined
    }

    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let measurementGeneration = 0
    let pending = Promise.resolve()
    const previous = new Map<string, { width: number; height: number }>()

    const measure = (pane: BrowserSplitViewPane | undefined, canvas: HTMLDivElement) => {
      const rect = canvas.getBoundingClientRect()
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      const visible =
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth + 1 &&
        rect.bottom <= window.innerHeight + 1
      const key = pane ?? 'single'
      const before = previous.get(key)
      const minimumWidth = pane === undefined ? 320 : splitOrientation === 'left-right' ? 160 : 320
      const minimumHeight = pane === undefined ? 240 : 120

      if (
        !visible ||
        width < minimumWidth ||
        height < minimumHeight ||
        (before !== undefined && Math.abs(width - before.width) < 2 && Math.abs(height - before.height) < 2)
      ) {
        return undefined
      }

      previous.set(key, { width, height })
      return { pane, width, height }
    }

    const applySizes = (generation: number) => {
      pending = pending
        .then(async () => {
          if (disposed || generation !== measurementGeneration) return
          for (const item of canvases) {
            if (disposed || generation !== measurementGeneration) return
            const size = measure(item.pane, item.element as HTMLDivElement)
            if (size === undefined) continue

            if (size.pane !== undefined) {
              await runSplitView({ action: 'resize', pane: size.pane, width: size.width, height: size.height })
            } else if (liveViewInitializedSessionRef.current !== sessionId) {
              liveViewInitializedSessionRef.current = sessionId
              await runLiveView({ action: 'initialize', mode: liveViewPreference(), width: size.width, height: size.height })
            } else {
              await runLiveView({ action: 'resize', width: size.width, height: size.height })
            }
          }
        })
        .catch(() => {})
    }

    const schedule = () => {
      const generation = ++measurementGeneration
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        if (!disposed) applySizes(generation)
      }, 180)
    }

    const observer = new ResizeObserver(schedule)
    for (const item of canvases) {
      if (item.element) observer.observe(item.element)
    }
    schedule()

    return () => {
      disposed = true
      measurementGeneration += 1
      if (timer !== undefined) clearTimeout(timer)
      observer.disconnect()
    }
  }, [
    sessionId,
    view,
    snapshot.available,
    snapshot.liveView?.initialized,
    snapshot.splitView?.enabled,
    snapshot.splitView?.orientation,
    snapshot.splitView?.ratio,
    splitRatio,
    runLiveView,
    runSplitView,
    splitOrientation,
  ])

  return { liveCanvasRef, topCanvasRef, bottomCanvasRef }
}
