import { useEffect, useRef } from 'react'
import type { BrowserSplitViewPane, BrowserUserInput } from '../../domain/protocol.ts'

interface PointerGestureState {
  identity: { viewId: string; streamGeneration: number; frameSequence: number; viewportGeneration: number }
  pane?: BrowserSplitViewPane
  latest?: { x: number; y: number }
  last: { x: number; y: number }
  animationFrame?: number
  pressed: Promise<boolean>
  chain: Promise<unknown>
}

export type LiveIdentity = { viewId: string; streamGeneration: number; frameSequence: number; viewportGeneration: number }

/**
 * 把实况图片上的指针手势翻译成页面里的真实按下、拖动与松开。
 *
 * 拖动过程按帧合流（同一帧内只投递最后一个坐标），按下没被宿主接受时后续 move/up 全部丢弃，
 * 这样页面里不会出现「松开了但从没按下」的悬空状态。分享拖拽开启时让位给原生图片拖动。
 */
export function usePointerGestures(
  shareDragArmed: boolean,
  point: (clientX: number, clientY: number, pane?: BrowserSplitViewPane, clamp?: boolean) => { x: number; y: number } | undefined,
  liveIdentity: (pane?: BrowserSplitViewPane) => LiveIdentity | undefined,
  focusImeProxy: (clientX: number, clientY: number, pane?: BrowserSplitViewPane) => void,
  runInput: (input: BrowserUserInput) => Promise<unknown>,
  onKeyDown: (event: React.KeyboardEvent<HTMLImageElement>, pane?: BrowserSplitViewPane) => void,
) {
  const pointerGestures = useRef(new Map<number, PointerGestureState>())

  useEffect(() => {
    const gestures = pointerGestures.current
    return () => {
      for (const gesture of gestures.values()) {
        if (gesture.animationFrame !== undefined) cancelAnimationFrame(gesture.animationFrame)
      }
      gestures.clear()
    }
  }, [])

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
      if (shareDragArmed) return
      const button = pointerButton(event.button)
      const target = point(event.clientX, event.clientY, pane)
      const identity = liveIdentity(pane)
      if (button === undefined || target === undefined || identity === undefined) return

      // 不拦截冒泡：外层面板的 onPointerDown 还要负责切换双页分屏的焦点窗格。
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      if (button === 'left') focusImeProxy(event.clientX, event.clientY, pane)

      const pressed = runInput({
        action: 'mouse_down' as const,
        ...target,
        ...identity,
        button,
        clickCount: Math.min(Math.max(event.detail || 1, 1), 3),
      }).then(result => (result as { ok?: boolean } | undefined)?.ok === true)

      pointerGestures.current.set(event.pointerId, {
        identity,
        pane,
        last: target,
        pressed,
        chain: pressed,
      })
    },
    onPointerMove: (event: React.PointerEvent<HTMLImageElement>) => {
      const gesture = pointerGestures.current.get(event.pointerId)
      if (gesture === undefined) return
      const target = point(event.clientX, event.clientY, gesture.pane, true)
      if (target === undefined) return

      event.preventDefault()
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
      event.preventDefault()
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLImageElement>) => {
      onKeyDown(event, pane)
    },
  })

  return { livePointerHandlers }
}
