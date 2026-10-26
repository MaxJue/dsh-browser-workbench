import { useCallback, useSyncExternalStore } from 'react'
import type { PanelController } from '../panel-controller.ts'
import type { BrowserPanelView } from '../../domain/protocol.ts'

export interface PanelSyncState {
  open: boolean
  view?: BrowserPanelView
}

// Server/SSR snapshot and the never-mounted fallback must be referentially stable too,
// otherwise a new object per read re-renders forever (React error #185).
const closedSnapshot: PanelSyncState = Object.freeze({ open: false })

/**
 * 使用 React 18/19 标准的 useSyncExternalStore 订阅 PanelController 的外部挂载状态，杜绝并发撕裂。
 *
 * 订阅函数与快照读函数必须保持引用稳定：React 在每次渲染都会比较它们，内联箭头函数会让
 * useSyncExternalStore 每一轮都重新订阅，而订阅又立即通知一次，于是渲染 -> 订阅 -> 通知 ->
 * 渲染无限循环（React error #185），随后整个 slot 崩溃。这里用 useCallback 固定两者。
 */
export function usePanelSync(controller: PanelController, sessionId: string): PanelSyncState {
  const subscribe = useCallback(
    (callback: () => void) => controller.subscribe(sessionId, callback),
    [controller, sessionId],
  )
  const getSnapshot = useCallback(() => controller.getSnapshot(sessionId), [controller, sessionId])
  return useSyncExternalStore(subscribe, getSnapshot, () => closedSnapshot)
}
