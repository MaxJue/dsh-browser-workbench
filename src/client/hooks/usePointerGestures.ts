import { useEffect, useRef } from 'react'
import type { BrowserPanelSnapshot, BrowserSplitViewPane, BrowserUserInput } from '../../domain/protocol.ts'

export type UntracedBrowserUserInput = BrowserUserInput extends infer Input
  ? Input extends BrowserUserInput
    ? Omit<Input, 'inputTraceId' | 'clientRawAt' | 'clientNormalizedAt'>
    : never
  : never

interface PointerGestureState {
  identity: { viewId: string; streamGeneration: number; frameSequence: number; viewportGeneration: number }
  pane?: BrowserSplitViewPane
  latest?: { x: number; y: number }
  last: { x: number; y: number }
  animationFrame?: number
  pressed: Promise<boolean>
  chain: Promise<unknown>
}

export function usePointerGestures(
  snapshot: BrowserPanelSnapshot,
  shareDragArmed: boolean,
  point: (clientX: number, clientY: number, pane?: BrowserSplitViewPane, clamp?: boolean) => { x: number; y: number } | undefined,
  liveIdentity: (pane?: BrowserSplitViewPane) => { viewId: string; streamGeneration: number; frameSequence: number; viewportGeneration: number } | undefined,
  focusImeProxy: (clientX: number, clientY: number, pane?: BrowserSplitViewPane) => void,
  runInput: (input: UntracedBrowserUserInput, clientRawAt?: number) => Promise<unknown>,
  onKeyDown: (event: React.KeyboardEvent<HTMLImageElement>, pane?: BrowserSplitViewPane) => void,
) {
  const pointerGestures = useRef(new Map<number, PointerGestureState>())

  // 控制权转给模型时清理所有未完成的手势
  useEffect(() => {
    if (snapshot.control?.owner !== 'user') {
      for (const gesture of pointerGestures.current.values()) {
        if (gesture.animationFrame !== undefined) cancelAnimationFrame(gesture.animationFrame)
      }
      pointerGestures.current.clear()
    }
  }, [snapshot.control?.owner])

  const pointerButton = (button: number): 'left' | 'middle' | 'right' | undefined =>
    button === 0 ? 'left' : button === 1 ? 'middle' : button === 2 ? 'right' : undefined

  const flushPointerMove = (pointerId: number) => {
    const gesture = pointerGestures.current.get(pointerId)
    if (gesture === undefined) return
    gesture.animationFrame = undefined
    const target = gesture.latest
    gesture.latest = undefined
    if (target === undefined) return
    gesture.last = target

    gesture.chain = gesture.chain.then(async () => {
      if (!(await gesture.pressed)) return undefined
      return runInput({ action: 'mouse_move', ...target, ...gesture.identity })
    })
  }

  const livePointerHandlers = (pane?: BrowserSplitViewPane) => ({
    onPointerDown: (event: React.PointerEvent<HTMLImageElement>) => {
      if (snapshot.control?.owner !== 'user' || shareDragArmed) return
      const button = pointerButton(event.button)
      const target = point(event.clientX, event.clientY, pane)
      const identity = liveIdentity(pane)
      if (button === undefined || target === undefined || identity === undefined) return

      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      if (button === 'left') focusImeProxy(event.clientX, event.clientY, pane)

      const pressed = runInput({
        action: 'mouse_down' as const,
        ...target,
        ...identity,
        button,
        clickCount: Math.min(Math.max(event.detail || 1, 1), 3),
      }).then(result => (result as { ok?: boolean } | undefined)?.ok === true)

      const gesture: PointerGestureState = {
        identity,
        pane,
        last: target,
        pressed,
        chain: pressed,
      }
      pointerGestures.current.set(event.pointerId, gesture)
    },
    onPointerMove: (event: React.PointerEvent<HTMLImageElement>) => {
      const gesture = pointerGestures.current.get(event.pointerId)
      if (gesture === undefined) return
      const target = point(event.clientX, event.clientY, gesture.pane, true)
      if (target === undefined) return

      event.preventDefault()
      event.stopPropagation()
      gesture.latest = target
      if (gesture.animationFrame === undefined) {
        gesture.animationFrame = requestAnimationFrame(() => {
          flushPointerMove(event.pointerId)
        })
      }
    },
    onPointerUp: (event: React.PointerEvent<HTMLImageElement>) => {
      const gesture = pointerGestures.current.get(event.pointerId)
      if (gesture === undefined) return
      event.preventDefault()
      event.stopPropagation()
      if (gesture.animationFrame !== undefined) cancelAnimationFrame(gesture.animationFrame)

      const target = point(event.clientX, event.clientY, gesture.pane, true) ?? gesture.latest ?? gesture.last
      const pending = gesture.latest
      pointerGestures.current.delete(event.pointerId)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }

      gesture.chain = gesture.chain.then(async () => {
        if (!(await gesture.pressed)) return undefined
        if (pending !== undefined) await runInput({ action: 'mouse_move', ...pending, ...gesture.identity })
        return runInput({ action: 'mouse_up', ...target, ...gesture.identity })
      })
    },
    onPointerCancel: (event: React.PointerEvent<HTMLImageElement>) => {
      const gesture = pointerGestures.current.get(event.pointerId)
      if (gesture === undefined) return
      if (gesture.animationFrame !== undefined) cancelAnimationFrame(gesture.animationFrame)
      pointerGestures.current.delete(event.pointerId)

      gesture.chain = gesture.chain.then(async () => {
        if (!(await gesture.pressed)) return undefined
        return runInput({ action: 'mouse_up', ...gesture.last, ...gesture.identity })
      })
    },
    onContextMenu: (event: React.MouseEvent<HTMLImageElement>) => {
      if (snapshot.control?.owner === 'user') event.preventDefault()
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLImageElement>) => {
      onKeyDown(event, pane)
    },
  })

  return { livePointerHandlers }
}
