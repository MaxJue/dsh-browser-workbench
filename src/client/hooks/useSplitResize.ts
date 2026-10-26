import { useEffect, useRef, useState } from 'react'
import type { BrowserSplitViewInput } from '../../domain/protocol.ts'

export function useSplitResize(
  hostRatio = 0.5,
  splitOrientation: 'top-bottom' | 'left-right' = 'top-bottom',
  runSplitView: (input: BrowserSplitViewInput) => Promise<unknown>,
) {
  const [splitRatio, setSplitRatio] = useState(hostRatio)
  const splitContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSplitRatio(hostRatio)
  }, [hostRatio])

  const beginSplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = splitContainerRef.current
    if (container === null) return
    event.currentTarget.setPointerCapture(event.pointerId)

    const ratioAt = (pointer: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      const raw =
        splitOrientation === 'left-right'
          ? (pointer.clientX - rect.left) / Math.max(rect.width, 1)
          : (pointer.clientY - rect.top) / Math.max(rect.height, 1)
      return Math.min(Math.max(raw, 0.4), 0.6)
    }

    const move = (pointer: PointerEvent) => {
      setSplitRatio(ratioAt(pointer))
    }

    const finish = (pointer: PointerEvent) => {
      const ratio = ratioAt(pointer)
      setSplitRatio(ratio)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      void runSplitView({ action: 'ratio', ratio, notifyAgent: true })
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
  }

  const adjustSplitByKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let ratio = splitRatio
    const increaseKey = splitOrientation === 'left-right' ? 'ArrowLeft' : 'ArrowUp'
    const decreaseKey = splitOrientation === 'left-right' ? 'ArrowRight' : 'ArrowDown'

    if (event.key === increaseKey) ratio = Math.min(ratio + 0.02, 0.6)
    else if (event.key === decreaseKey) ratio = Math.max(ratio - 0.02, 0.4)
    else if (event.key === 'Home') ratio = 0.4
    else if (event.key === 'End') ratio = 0.6
    else return

    event.preventDefault()
    setSplitRatio(ratio)
    void runSplitView({ action: 'ratio', ratio, notifyAgent: true })
  }

  const dividerProps = {
    onPointerDown: beginSplitResize,
    onKeyDown: adjustSplitByKey,
    role: 'separator' as const,
    tabIndex: 0,
    'aria-label': splitOrientation === 'left-right' ? '调整左右分屏比例' : '调整上下分屏比例',
    'aria-orientation': (splitOrientation === 'left-right' ? 'vertical' : 'horizontal') as 'vertical' | 'horizontal',
    'aria-valuemin': 40,
    'aria-valuemax': 60,
    'aria-valuenow': Math.round(splitRatio * 100),
  }

  return { splitRatio, setSplitRatio, splitContainerRef, beginSplitResize, adjustSplitByKey, dividerProps }
}
