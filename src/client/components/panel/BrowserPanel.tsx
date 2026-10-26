import { useEffect, useRef, useState, useTransition } from 'react'
import css from '../../panel.module.css'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  BrowserDebuggerInput,
  BrowserEmulateInput,
  BrowserInputTraceUpdate,
  BrowserLivePaneSnapshot,
  BrowserLiveViewInput,
  BrowserLiveViewMode,
  BrowserNetworkInput,
  BrowserPanelTabInput,
  BrowserPanelView,
  BrowserProfileInput,
  BrowserProviderInput,
  BrowserRecorderInput,
  BrowserSplitViewInput,
  BrowserSplitViewPane,
  BrowserTakeoverInput,
  BrowserUserInput,
} from '../../../domain/protocol.ts'
import type { PanelController } from '../../panel-controller.ts'
import type { Port } from '../../port.ts'
import { isBrowserPanelView, saveLiveViewPreference } from '../../panel-model.ts'
import { calculatePointProjection } from '../../utils/geometry.ts'
import { useBrowserSnapshot } from '../../hooks/useBrowserSnapshot.ts'
import { useSplitResize } from '../../hooks/useSplitResize.ts'
import { useLiveViewport } from '../../hooks/useLiveViewport.ts'
import { usePointerGestures, type UntracedBrowserUserInput } from '../../hooks/usePointerGestures.ts'
import { useImeProxy } from '../../hooks/useImeProxy.ts'
import { TabBar } from '../common/TabBar.tsx'
import { NavigationBar } from '../common/NavigationBar.tsx'
import { ErrorAlert } from '../common/ErrorAlert.tsx'
import { LiveView } from '../views/live/LiveView.tsx'
import { DiagnosticView } from '../views/diagnostic/DiagnosticView.tsx'
import { ConsoleView } from '../views/console/ConsoleView.tsx'
import { NetworkView } from '../views/network/NetworkView.tsx'
import { DebuggerView } from '../views/debugger/DebuggerView.tsx'
import { PerformanceView } from '../views/performance/PerformanceView.tsx'
import { ProviderView } from '../views/provider/ProviderView.tsx'
import { EmulationView } from '../views/emulation/EmulationView.tsx'
import { ExtensionsView } from '../views/extensions/ExtensionsView.tsx'

const BROWSER_TAB_KIND = 'dsh-browser-workbench.browser'

const viewLabels: Record<BrowserPanelView, string> = {
  live: '实况',
  diagnostic: '诊断',
  console: 'Console',
  network: 'Network',
  debugger: 'Debugger',
  performance: 'Performance',
  provider: 'Provider',
  extensions: '扩展管理',
  emulation: 'Emulation',
}

interface BrowserTabParams {
  view?: BrowserPanelView
}

type SessionSlotProps<K extends 'conversation.input.right' | 'sidebar.right.pane.tab'> = PropsRuntime<K> & {
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
  const params = tab.navigation.params as BrowserTabParams | undefined
  const view = isBrowserPanelView(params?.view) ? params.view : 'live'
  const onClose = tab.actions.close

  const [, startTransition] = useTransition()
  const onViewChange = (next: BrowserPanelView) => {
    startTransition(() => {
      tab.actions.openTab(BROWSER_TAB_KIND, { params: { view: next } })
    })
  }

  const closeTabRef = useRef(onClose)
  const openTabRef = useRef(onViewChange)
  closeTabRef.current = onClose
  openTabRef.current = onViewChange

  useEffect(
    () =>
      controller.attach(
        sessionId,
        tab.id,
        () => closeTabRef.current(),
        next => openTabRef.current(next),
      ),
    [controller, sessionId, tab.id],
  )

  useEffect(() => {
    controller.update(sessionId, tab.id, view)
  }, [controller, sessionId, tab.id, view])

  const { snapshot, error, setError, clearError } = useBrowserSnapshot(sessionId, view, port)

  const [address, setAddress] = useState('')
  const [shareDragArmed, setShareDragArmed] = useState(false)
  const suppressSharedFrameClick = useRef(false)
  const nextInputTrace = useRef(1)
  const pendingInputTraces = useRef(new Map<string, BrowserInputTraceUpdate>())
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

  const runDebugger = (input: BrowserDebuggerInput) =>
    run(() => port.debugger(sessionId, input), 'Debugger 操作需要恢复后重试。')
  const runTabs = (input: BrowserPanelTabInput) =>
    run(() => port.tabs(sessionId, input), '浏览器标签操作需要恢复后重试。')
  const runNetwork = (input: BrowserNetworkInput) =>
    run(() => port.network(sessionId, input), 'Network 操作需要恢复后重试。')
  const runProfile = (input: BrowserProfileInput) =>
    run(() => port.profile(sessionId, input), 'Performance 操作需要恢复后重试。')
  const runProvider = (input: BrowserProviderInput) =>
    run(() => port.provider(sessionId, input), 'Provider 操作需要恢复后重试。')
  const runEmulate = (input: BrowserEmulateInput) =>
    run(() => port.emulate(sessionId, input), 'Emulation 操作需要恢复后重试。')
  const runLiveView = (input: BrowserLiveViewInput) =>
    run(() => port.liveView(sessionId, input), '实况显示模式切换需要恢复后重试。')
  const runSplitView = (input: BrowserSplitViewInput) =>
    run(() => port.splitView(sessionId, input), '浏览器双页分屏操作需要恢复后重试。')
  const runTakeover = (input: BrowserTakeoverInput) =>
    run(() => port.takeover(sessionId, input), '接管操作需要恢复后重试。')
  const runRecorder = (input: BrowserRecorderInput) =>
    run(() => port.recorder(sessionId, input), 'Recorder 操作需要恢复后重试。')

  const runInput = async (input: UntracedBrowserUserInput, clientRawAt = Date.now()) => {
    const trace = {
      inputTraceId: `client-${sessionId}-${clientRawAt}-${nextInputTrace.current++}`,
      clientRawAt,
      clientNormalizedAt: Date.now(),
    }
    const action =
      input.action === 'insert_text'
        ? 'insert-text'
        : input.action === 'composition_commit'
          ? 'composition'
          : input.action === 'key_press'
            ? 'key-press'
            : input.action === 'paste'
              ? 'paste'
              : input.action === 'mouse_wheel'
                ? 'wheel'
                : 'pointer'

    const metadata: BrowserInputTraceUpdate = {
      inputTraceId: trace.inputTraceId,
      viewId: input.viewId,
      action: input.action === 'key_press' && input.composing === true ? 'composition' : action,
      sensitivity: 'normal',
      composing: input.composing ?? false,
      stage: 'client-normalized',
      timestamp: trace.clientNormalizedAt,
      outcome: 'observed',
    }
    pendingInputTraces.current.set(metadata.inputTraceId, metadata)
    await port
      .inputTrace(sessionId, metadata)
      .then(() => pendingInputTraces.current.delete(metadata.inputTraceId), () => undefined)
    try {
      const result = await port.input(sessionId, { ...input, ...trace } as BrowserUserInput)
      const output = result as { ok?: boolean; data?: { message?: string } }
      setError(output.ok === false ? output.data?.message ?? '用户输入未发送。' : undefined)
      return result
    } catch (cause) {
      await port
        .inputTrace(sessionId, {
          ...metadata,
          stage: 'rpc-received',
          timestamp: Date.now(),
          outcome: 'lost',
          reason: 'rpc-send-failed',
        })
        .catch(() => undefined)
      setError(cause instanceof Error ? cause.message : String(cause))
      return undefined
    }
  }

  const activeTab = snapshot.tabs.find(item => item.viewId === snapshot.activeViewId)
  const splitOrientation = snapshot.splitView?.orientation ?? 'top-bottom'
  const paneSnapshot = (pane: BrowserSplitViewPane): BrowserLivePaneSnapshot | undefined =>
    snapshot.splitView?.panes?.find(item => item.pane === pane)

  const liveIdentity = (pane?: BrowserSplitViewPane) => {
    const target = pane === undefined ? undefined : paneSnapshot(pane)
    const activeViewId = target?.viewId ?? snapshot.activeViewId
    const frame = target?.frame ?? snapshot.frame
    if (activeViewId === undefined || frame === undefined) return undefined
    return {
      viewId: activeViewId,
      streamGeneration: frame.streamGeneration,
      frameSequence: frame.sequence,
      viewportGeneration: frame.viewportGeneration,
    }
  }

  const point = (
    clientX: number,
    clientY: number,
    pane?: BrowserSplitViewPane,
    clamp = false,
  ): { x: number; y: number } | undefined => {
    const image = pane === 'top' ? topLiveRef.current : pane === 'bottom' ? bottomLiveRef.current : liveRef.current
    const frame = pane === undefined ? snapshot.frame : paneSnapshot(pane)?.frame
    if (image === null || frame === undefined) return undefined
    return calculatePointProjection(image.getBoundingClientRect(), frame, clientX, clientY, clamp)
  }

  const { splitRatio, splitContainerRef, dividerProps } = useSplitResize(
    snapshot.splitView?.ratio ?? 0.5,
    splitOrientation,
    runSplitView,
  )

  const { liveCanvasRef, topCanvasRef, bottomCanvasRef } = useLiveViewport(
    sessionId,
    view,
    snapshot,
    splitRatio,
    runLiveView,
    runSplitView,
  )

  const { imeProxyRef, focusImeProxy, sendKey, imeProxyHandlers } = useImeProxy(
    snapshot,
    livePanelRef,
    liveIdentity,
    runInput,
    setError,
  )

  const { livePointerHandlers } = usePointerGestures(
    snapshot,
    shareDragArmed,
    point,
    liveIdentity,
    focusImeProxy,
    runInput,
    sendKey,
  )

  useEffect(() => {
    setAddress(activeTab?.url ?? '')
  }, [snapshot.activeViewId, activeTab?.url])

  useEffect(() => {
    if (snapshot.control?.owner !== 'user') {
      setShareDragArmed(false)
      imeProxyRef.current?.blur()
    }
  }, [snapshot.control?.owner, imeProxyRef])

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

  const onWheel = (event: React.WheelEvent<HTMLImageElement>, pane?: BrowserSplitViewPane) => {
    if (snapshot.control?.owner !== 'user') return
    event.preventDefault()
    const target = point(event.clientX, event.clientY, pane)
    const identity = liveIdentity(pane)
    const paneState = pane === undefined ? undefined : paneSnapshot(pane)
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? Math.max(paneState?.liveView.height ?? snapshot.liveView?.height ?? 720, 1)
          : 1
    if (target !== undefined && identity !== undefined) {
      void runInput({
        action: 'mouse_wheel',
        ...target,
        ...identity,
        deltaX: event.deltaX * unit,
        deltaY: event.deltaY * unit,
      })
    }
  }

  const onDragStart = (event: React.DragEvent<HTMLImageElement>) => {
    if (!shareDragArmed) {
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
    <section className={css.panel} data-live={view === 'live' || undefined}>
      {view !== 'live' && (
        <header className={css.panelHeader}>
          <strong>{viewLabels[view]}</strong>
          <span>
            {view === 'extensions' && (
              <button
                type="button"
                aria-label="返回浏览器实况"
                title="返回浏览器实况"
                onClick={() => onViewChange('live')}
              >
                返回实况
              </button>
            )}
            <button type="button" aria-label="关闭右侧浏览器" title="关闭右侧浏览器" onClick={onClose}>
              ×
            </button>
          </span>
        </header>
      )}

      <div ref={browserShellRef} className={css.browserShell}>
        <ErrorAlert error={error} onClose={clearError} />

        {view !== 'provider' && !snapshot.available && (
          <div className={css.connectionRequired} role="status">
            <strong>浏览器尚未连接</strong>
            <span>请先打开 Provider 面板，按步骤连接已开启远程调试的 Chrome 或 Edge。</span>
          </div>
        )}

        {(view === 'provider' || snapshot.available) && (
          <>
            {snapshot.available && view !== 'provider' && (
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
              </>
            )}

            {view !== 'provider' && snapshot.available && (
              <div className={css.browserContent}>
                {snapshot.available && snapshot.tabs.length === 0 && view !== 'extensions' && (
                  <div className={css.message}>{snapshot.message ?? '当前没有浏览器标签，请点击 + 新建标签。'}</div>
                )}

                {view === 'live' && snapshot.available && snapshot.activeViewId !== undefined && (
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
                    imeProxyRef={imeProxyRef}
                    imeProxyHandlers={imeProxyHandlers}
                    dividerProps={dividerProps}
                    pointerHandlers={livePointerHandlers}
                    onWheel={onWheel}
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
                    onToggleTakeover={() => {
                      void runTakeover({ action: snapshot.control?.owner === 'user' ? 'return' : 'request' })
                    }}
                    onToggleShareDrag={() => setShareDragArmed(v => !v)}
                    onOpenDiagnostic={onViewChange}
                    onRecorderAction={(action, mode) => {
                      void runRecorder({ action, ...(mode ? { mode } : {}) })
                    }}
                    onClosePanel={onClose}
                  />
                )}

                {view === 'diagnostic' && snapshot.available && snapshot.activeViewId !== undefined && (
                  <DiagnosticView snapshot={snapshot} runRecorder={runRecorder} />
                )}

                {view === 'console' && snapshot.available && snapshot.activeViewId !== undefined && (
                  <ConsoleView consoleMessages={snapshot.console} />
                )}

                {view === 'network' && snapshot.available && snapshot.activeViewId !== undefined && (
                  <NetworkView snapshot={snapshot} runNetwork={runNetwork} />
                )}

                {view === 'debugger' && snapshot.activeViewId !== undefined && (
                  <DebuggerView snapshot={snapshot} runDebugger={runDebugger} setError={setError} />
                )}

                {view === 'performance' && snapshot.activeViewId !== undefined && (
                  <PerformanceView snapshot={snapshot} runProfile={runProfile} />
                )}

                {view === 'extensions' && <ExtensionsView />}

                {view === 'emulation' && snapshot.activeViewId !== undefined && (
                  <EmulationView runEmulate={runEmulate} />
                )}
              </div>
            )}

            {view === 'provider' && (
              <ProviderView snapshot={snapshot} runProvider={runProvider} error={error} setError={setError} />
            )}
          </>
        )}
      </div>
    </section>
  )
}
