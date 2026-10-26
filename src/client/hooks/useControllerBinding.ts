import { useEffect, useReducer, useState } from 'react'
import type { BrowserControllerSnapshot, BrowserPanelView } from '../../domain/protocol.ts'
import type { PanelController } from '../panel-controller.ts'
import type { Port } from '../port.ts'

export type ConfirmDialogType = 'none' | 'activate' | 'other' | 'release'

export interface ControlMenuState {
  menuOpen: boolean
  confirmType: ConfirmDialogType
  arbitratedToolsOpen: boolean
}

type MenuAction =
  | { type: 'TOGGLE_MENU' }
  | { type: 'CLOSE_ALL' }
  | { type: 'SET_CONFIRM'; confirmType: ConfirmDialogType }
  | { type: 'TOGGLE_TOOLS' }
  | { type: 'CLOSE_TOOLS' }
  | { type: 'RESET' }

function menuReducer(state: ControlMenuState, action: MenuAction): ControlMenuState {
  switch (action.type) {
    case 'TOGGLE_MENU':
      return state.menuOpen
        ? { menuOpen: false, confirmType: 'none', arbitratedToolsOpen: false }
        : { menuOpen: true, confirmType: 'none', arbitratedToolsOpen: false }
    case 'CLOSE_ALL':
      return { menuOpen: false, confirmType: 'none', arbitratedToolsOpen: false }
    case 'SET_CONFIRM':
      return { ...state, confirmType: action.confirmType }
    case 'TOGGLE_TOOLS':
      return { ...state, arbitratedToolsOpen: !state.arbitratedToolsOpen }
    case 'CLOSE_TOOLS':
      return { ...state, arbitratedToolsOpen: false }
    case 'RESET':
      return { menuOpen: false, confirmType: 'none', arbitratedToolsOpen: false }
    default:
      return state
  }
}

export function useControllerBinding(
  sessionId: string,
  controller: PanelController,
  port: Port,
  panelAvailable: boolean,
  panelOpen: boolean,
  currentView: BrowserPanelView,
) {
  const [modalState, dispatch] = useReducer(menuReducer, {
    menuOpen: false,
    confirmType: 'none',
    arbitratedToolsOpen: false,
  })

  const [message, setMessage] = useState<string>()
  const [controllerBinding, setControllerBinding] = useState<{
    sessionId: string
    snapshot: BrowserControllerSnapshot
  }>()

  const controllerState = controllerBinding?.sessionId === sessionId ? controllerBinding.snapshot : undefined
  const loadingController = controllerState === undefined
  const switching = controllerState?.status === 'activating' || controllerState?.status === 'releasing'
  const BrowserWorkbenchSelected = controllerState?.registrationMode === 'global' || controllerState?.mode === 'dsh-browser-tools'
  const active = controllerState?.registrationMode === 'global' || (controllerState?.mode === 'dsh-browser-tools' && controllerState.status === 'active')
  const BrowserWorkbenchUnavailable = BrowserWorkbenchSelected && !active
  const unselected = controllerState?.registrationMode === 'session-select' && controllerState.mode === 'unselected'
  const selectedOther = controllerState?.registrationMode === 'session-select' && controllerState.mode === 'other'
  const otherBrowserToolsAvailable = (controllerState?.conflictingTools.length ?? 0) > 0

  const controllerLabel = loadingController
    ? '浏览器选择读取中'
    : active
      ? 'DSH BrowserWorkbench（已锁定）'
      : BrowserWorkbenchUnavailable
        ? 'DSH BrowserWorkbench（已锁定，暂不可用）'
        : selectedOther
          ? '其他浏览器工具（已锁定）'
          : '尚未选择浏览器工具'

  const refreshController = async () => {
    try {
      const snapshot = await port.controllerStatus(sessionId)
      setControllerBinding({ sessionId, snapshot })
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    let disposed = false
    setControllerBinding(undefined)
    dispatch({ type: 'RESET' })
    setMessage(undefined)

    const refresh = async () => {
      try {
        const snapshot = await port.controllerStatus(sessionId)
        if (!disposed) setControllerBinding({ sessionId, snapshot })
      } catch (cause) {
        if (!disposed) setMessage(cause instanceof Error ? cause.message : String(cause))
      }
    }

    void refresh()
    return () => { disposed = true }
  }, [controller, port, sessionId])

  const activate = async () => {
    dispatch({ type: 'SET_CONFIRM', confirmType: 'none' })
    setMessage(undefined)
    if (!panelAvailable) {
      setMessage('当前会话尚未形成正式 Agent Session；请先发送首条消息，再为正式 Session 启用 DSH BrowserWorkbench。')
      return
    }
    try {
      const snapshot = await port.controllerActivate(sessionId)
      setControllerBinding({ sessionId, snapshot })
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
      await refreshController()
    }
  }

  const selectOther = async () => {
    dispatch({ type: 'SET_CONFIRM', confirmType: 'none' })
    setMessage(undefined)
    if (!panelAvailable) {
      setMessage('当前会话尚未形成正式 Agent Session；请先发送首条消息，再为正式 Session 选择浏览器工具。')
      return
    }
    try {
      const snapshot = await port.controllerSelectOther(sessionId)
      setControllerBinding({ sessionId, snapshot })
      dispatch({ type: 'CLOSE_ALL' })
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
      await refreshController()
    }
  }

  const release = async () => {
    dispatch({ type: 'SET_CONFIRM', confirmType: 'none' })
    setMessage(undefined)
    controller.close(sessionId)
    try {
      const snapshot = await port.controllerRelease(sessionId)
      setControllerBinding({ sessionId, snapshot })
      dispatch({ type: 'CLOSE_ALL' })
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
      await refreshController()
    }
  }

  const toggle = () => {
    if (loadingController) {
      setMessage('正在读取当前 Session 的浏览器控制器状态，请稍候。')
      return
    }
    if (!active) {
      dispatch({ type: 'SET_CONFIRM', confirmType: 'activate' })
      return
    }
    if (!panelAvailable) {
      setMessage('当前会话尚未形成正式 Agent Session；发送首条消息后即可打开完整浏览器面板。')
      return
    }
    if (panelOpen) {
      controller.close(sessionId)
    } else {
      const result = controller.open(sessionId, currentView)
      setMessage(result.message)
    }
    dispatch({ type: 'CLOSE_ALL' })
  }

  const selectView = (next: BrowserPanelView) => {
    if (loadingController) {
      setMessage('正在读取当前 Session 的浏览器控制器状态，请稍候。')
      return
    }
    if (!active) {
      dispatch({ type: 'SET_CONFIRM', confirmType: 'activate' })
      return
    }
    if (!panelAvailable) {
      setMessage('当前会话尚未形成正式 Agent Session；发送首条消息后即可打开完整浏览器面板。')
      return
    }
    const result = controller.open(sessionId, next)
    setMessage(result.message)
    dispatch({ type: 'CLOSE_ALL' })
  }

  return {
    modalState,
    dispatch,
    message,
    setMessage,
    controllerState,
    loadingController,
    switching,
    active,
    BrowserWorkbenchUnavailable,
    unselected,
    selectedOther,
    otherBrowserToolsAvailable,
    controllerLabel,
    refreshController,
    activate,
    selectOther,
    release,
    toggle,
    selectView,
  }
}
