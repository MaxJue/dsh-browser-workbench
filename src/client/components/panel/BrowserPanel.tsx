import { useEffect, useRef, useState } from 'react'
import css from '../../panel.module.css'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  BrowserLiveViewInput,
  BrowserLiveViewMode,
  BrowserPanelTabInput,
  BrowserSplitViewInput,
} from '../../../domain/protocol.ts'
import type { PanelController } from '../../panel-controller.ts'
import type { Port } from '../../port.ts'
import { saveLiveViewPreference } from '../../panel-model.ts'
import { useBrowserSnapshot } from '../../hooks/useBrowserSnapshot.ts'
import { useSplitResize } from '../../hooks/useSplitResize.ts'
import { useLiveViewport } from '../../hooks/useLiveViewport.ts'
import { TabBar } from '../common/TabBar.tsx'
import { NavigationBar } from '../common/NavigationBar.tsx'
import { ErrorAlert } from '../common/ErrorAlert.tsx'
import { LiveView } from '../views/live/LiveView.tsx'

const BROWSER_TAB_KIND = 'dsh-browser-workbench.browser'

type SessionSlotProps<K extends 'sidebar.right.pane.tab'> = PropsRuntime<K> & {
  sessionId: string
}

export function BrowserPanel({
  sessionId,
  port,
  controller,
  useTabInfo,
}: SessionSlotProps<'sidebar.right.pane.tab'> & {
  port: Port
  controller: PanelController
}) {
  const { tab } = useTabInfo()
  const onClose = tab.actions.close
  // 右侧面板只服务人：实况画面。agent 向的视图（console/network/debugger…）
  // 是工具能力的重复投影，已整体移除，面板不再承载视图路由。
  const LIVE = 'live' as const

  const reopenLiveTab = () => {
    tab.actions.openTab(BROWSER_TAB_KIND, { params: { view: 'live' } })
  }

  const closeTabRef = useRef(onClose)
  const openTabRef = useRef(reopenLiveTab)
  closeTabRef.current = onClose
  openTabRef.current = reopenLiveTab

  useEffect(
    () =>
      controller.attach(
        sessionId,
        tab.id,
        () => closeTabRef.current(),
        () => openTabRef.current(),
      ),
    [controller, sessionId, tab.id],
  )

  useEffect(() => {
    controller.update(sessionId, tab.id, LIVE)
  }, [controller, sessionId, tab.id])

  const { snapshot, error, setError, clearError } = useBrowserSnapshot(sessionId, LIVE, port)

  const [address, setAddress] = useState('')
  const [shareDragArmed, setShareDragArmed] = useState(false)
  const suppressSharedFrameClick = useRef(false)
  const livePanelRef = useRef<HTMLDivElement>(null)
  const browserShellRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<HTMLImageElement>(null)
  const topLiveRef = useRef<HTMLImageElement>(null)
  const bottomLiveRef = useRef<HTMLImageElement>(null)

  const run = async (operation: () => Promise<unknown>, fallback: string): Promise<unknown> => {
    try {
      const result = await operation()
      const output = result as { ok?: boolean; data?: { message?: string } }
      setError(output.ok === false ? output.data?.message ?? fallback : undefined)
      return result
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return undefined
    }
  }

  const runTabs = (input: BrowserPanelTabInput) =>
    run(() => port.tabs(sessionId, input), '浏览器标签操作需要恢复后重试。')
  const runLiveView = (input: BrowserLiveViewInput) =>
    run(() => port.liveView(sessionId, input), '实况显示模式切换需要恢复后重试。')
  const runSplitView = (input: BrowserSplitViewInput) =>
    run(() => port.splitView(sessionId, input), '浏览器双页分屏操作需要恢复后重试。')

  const activeTab = snapshot.tabs.find(item => item.viewId === snapshot.activeViewId)
  const splitOrientation = snapshot.splitView?.orientation ?? 'top-bottom'

  const { splitRatio, splitContainerRef, dividerProps } = useSplitResize(
    snapshot.splitView?.ratio ?? 0.5,
    splitOrientation,
    runSplitView,
  )

  const { liveCanvasRef, topCanvasRef, bottomCanvasRef } = useLiveViewport(
    sessionId,
    LIVE,
    snapshot,
    splitRatio,
    runLiveView,
    runSplitView,
  )

  useEffect(() => {
    setAddress(activeTab?.url ?? '')
  }, [snapshot.activeViewId, activeTab?.url])

  const switchLiveView = async (mode: BrowserLiveViewMode) => {
    const canvas = liveCanvasRef.current
    const rect = canvas?.getBoundingClientRect()
    const result = (await runLiveView({
      action: mode,
      ...(snapshot.activeViewId === undefined ? {} : { viewId: snapshot.activeViewId }),
      ...(mode === 'adaptive' && rect !== undefined
        ? { width: Math.round(rect.width), height: Math.round(rect.height) }
        : {}),
      notifyAgent: true,
    })) as { ok?: boolean } | undefined
    if (result?.ok === true) saveLiveViewPreference(mode)
  }

  const navigateAddress = async () => {
    if (snapshot.activeViewId === undefined || address.trim() === '') return
    await runTabs({ action: 'navigate', viewId: snapshot.activeViewId, url: address.trim() })
  }

  const onDragStart = (event: React.DragEvent<HTMLImageElement>) => {
    if (!shareDragArmed) return
    const frame = snapshot.frame
    if (frame === undefined) {
      event.preventDefault()
      return
    }
    const transfer = event.dataTransfer
    if (!transfer) return
    try {
      const byteCharacters = atob(frame.data)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const blob = new Blob([byteArray], { type: frame.mediaType })
      const file = new File([blob], `browser-${snapshot.sessionId}-${frame.sequence}.jpg`, {
        type: frame.mediaType,
      })
      transfer.setData('DownloadURL', `${frame.mediaType}:${file.name}:data:${frame.mediaType};base64,${frame.data}`)
      if (transfer.items?.add) {
        transfer.items.add(file)
      }
      transfer.effectAllowed = 'copy'
    } catch {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    suppressSharedFrameClick.current = true
  }

  const onDragEnd = () => {
    setShareDragArmed(false)
    window.setTimeout(() => {
      suppressSharedFrameClick.current = false
    }, 0)
  }

  return (
    <section className={css.panel} data-live={true}>
      <div ref={browserShellRef} className={css.browserShell}>
        <ErrorAlert error={error} onClose={clearError} />

        {!snapshot.available && (
          <div className={css.connectionRequired} role="status">
            <strong>浏览器尚未启动</strong>
            <span>直接调用浏览器工具会自动启动本 Session 独立的浏览器；启动后这里显示实况画面。</span>
          </div>
        )}

        {snapshot.available && (
          <>
            <TabBar
              tabs={snapshot.tabs}
              onSelectTab={viewId => {
                void runTabs({ action: 'select', viewId, notifyAgent: true })
              }}
              onCloseTab={viewId => {
                void runTabs({ action: 'close', viewId })
              }}
              onNewTab={() => {
                void runTabs({ action: 'new' })
              }}
            />

            <NavigationBar
              activeViewId={snapshot.activeViewId}
              address={address}
              onAddressChange={setAddress}
              onNavigate={() => {
                void navigateAddress()
              }}
              onBack={() => {
                if (snapshot.activeViewId !== undefined) {
                  void runTabs({ action: 'back', viewId: snapshot.activeViewId })
                }
              }}
              onForward={() => {
                if (snapshot.activeViewId !== undefined) {
                  void runTabs({ action: 'forward', viewId: snapshot.activeViewId })
                }
              }}
              onReload={() => {
                if (snapshot.activeViewId !== undefined) {
                  void runTabs({ action: 'reload', viewId: snapshot.activeViewId })
                }
              }}
            />

            <div className={css.browserContent}>
              {snapshot.tabs.length === 0 && (
                <div className={css.message}>{snapshot.message ?? '当前没有浏览器标签，请点击 + 新建标签。'}</div>
              )}

              {snapshot.activeViewId !== undefined && (
                <LiveView
                  snapshot={snapshot}
                  shareDragArmed={shareDragArmed}
                  splitRatio={splitRatio}
                  splitOrientation={splitOrientation}
                  livePanelRef={livePanelRef}
                  liveCanvasRef={liveCanvasRef}
                  liveRef={liveRef}
                  topCanvasRef={topCanvasRef}
                  bottomCanvasRef={bottomCanvasRef}
                  topLiveRef={topLiveRef}
                  bottomLiveRef={bottomLiveRef}
                  splitContainerRef={splitContainerRef}
                  dividerProps={dividerProps}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onFocusPane={pane => {
                    void runSplitView({ action: 'focus', pane, notifyAgent: true })
                  }}
                  onSwitchLiveView={mode => {
                    void switchLiveView(mode)
                  }}
                  onOpenSplitView={orientation => {
                    void runSplitView({ action: 'open', orientation, notifyAgent: true })
                  }}
                  onCloseSplitView={() => {
                    void runSplitView({ action: 'close', notifyAgent: true })
                  }}
                  onToggleSplitOrientation={() => {
                    void runSplitView({
                      action: 'orientation',
                      orientation: splitOrientation === 'left-right' ? 'top-bottom' : 'left-right',
                      notifyAgent: true,
                    })
                  }}
                  onSwapSplitPanes={() => {
                    void runSplitView({ action: 'swap', notifyAgent: true })
                  }}
                  onResetSplitRatio={() => {
                    void runSplitView({ action: 'ratio', ratio: 0.5, notifyAgent: true })
                  }}
                  onToggleShareDrag={() => setShareDragArmed(v => !v)}
                  onClosePanel={onClose}
                />
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
