import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {
  BrowserControllerSnapshot,
  BrowserDebuggerInput,
  BrowserEmulateInput,
  BrowserExtensionInput,
  BrowserFrameCursor,
  BrowserLiveViewInput,
  BrowserNetworkInput,
  BrowserPanelActivity,
  BrowserPanelSnapshot,
  BrowserPanelTabInput,
  BrowserPanelView,
  BrowserProfileInput,
  BrowserProviderInput,
  BrowserRecorderInput,
  BrowserSplitViewInput,
  BrowserSplitViewPane,
} from '../domain/protocol.ts'
import { valueOf } from './panel-model.ts'

export const CHANNEL = '/api'
export const RPC_METHOD = 'browser-tools'

export interface BrowserBindingOverviewEntry {
  sessionId: string
  createdAt?: number
  snapshot: BrowserControllerSnapshot
}

/** 设置页的三种绑定：自动启动、连接现有 Chrome/Edge、停用本插件。 */
export type BrowserToolChoice = 'workbench' | 'existing' | 'off'

export interface BrowserBindingOverview {
  /** 运行时实际生效的注册模式（global 配置被降级时可能与 configuredMode 不同）。 */
  registrationMode: 'global' | 'session-select' | 'disabled'
  /** Profile 补丁里配置的注册模式。 */
  configuredMode: 'global' | 'session-select' | 'disabled'
  /** Profile 补丁里配置的浏览器来源。 */
  providerMode: 'auto' | 'external'
  /** 当前配置对应的卡片。 */
  choice: BrowserToolChoice
  /** 已保存的现有浏览器调试端点。 */
  endpoint?: string
  /** 设置页能否直接改写绑定。 */
  configurable: boolean
  /** 不可写时的原因。 */
  configurableMessage?: string
  sessions: BrowserBindingOverviewEntry[]
}

export interface Port {
  /** 设置页的全局绑定总览；不需要 Session 上下文。 */
  overview(): Promise<BrowserBindingOverview>
  /** 把浏览器绑定写回 Profile 补丁并触发热重载。 */
  setBrowserChoice(choice: BrowserToolChoice, endpoint?: string): Promise<unknown>
  controllerStatus(sessionId: string): Promise<BrowserControllerSnapshot>
  controllerActivate(sessionId: string): Promise<BrowserControllerSnapshot>
  controllerSelectOther(sessionId: string): Promise<BrowserControllerSnapshot>
  controllerRelease(sessionId: string): Promise<BrowserControllerSnapshot>
  /** 面板关闭时的只读活动探测，不会创建浏览器会话或启动 screencast。 */
  activity(sessionId: string): Promise<BrowserPanelActivity>
  snapshot(sessionId: string, view: BrowserPanelView, streamGeneration?: number, sequence?: number, splitCursors?: Partial<Record<BrowserSplitViewPane, BrowserFrameCursor>>, popupCursor?: BrowserFrameCursor, diagnosticReadSequence?: number): Promise<BrowserPanelSnapshot>
  tabs(sessionId: string, input: BrowserPanelTabInput): Promise<unknown>
  debugger(sessionId: string, input: BrowserDebuggerInput): Promise<unknown>
  network(sessionId: string, input: BrowserNetworkInput): Promise<unknown>
  profile(sessionId: string, input: BrowserProfileInput): Promise<unknown>
  provider(sessionId: string, input: BrowserProviderInput): Promise<unknown>
  extensions(sessionId: string, input: BrowserExtensionInput): Promise<unknown>
  emulate(sessionId: string, input: BrowserEmulateInput): Promise<unknown>
  liveView(sessionId: string, input: BrowserLiveViewInput): Promise<unknown>
  splitView(sessionId: string, input: BrowserSplitViewInput): Promise<unknown>
  recorder(sessionId: string, input: BrowserRecorderInput): Promise<unknown>
  close(sessionId: string, view: BrowserPanelView): Promise<void>
}

export function createPort(connection: ConnectionHandle): Port {
  const call = async <T>(endpoint: string, payload: unknown): Promise<T> => {
    return valueOf<T>(await connection.rpc.call(CHANNEL, RPC_METHOD, { endpoint, payload }))
  }

  return {
    overview: () => call('controller_overview', {}),
    setBrowserChoice: (choice, endpoint) => call('controller_set_browser_choice', { choice, ...(endpoint === undefined ? {} : { endpoint }) }),
    controllerStatus: sessionId => call('controller_status', { sessionId }),
    controllerActivate: sessionId => call('controller_activate', { sessionId }),
    controllerSelectOther: sessionId => call('controller_select_other', { sessionId }),
    controllerRelease: sessionId => call('controller_release', { sessionId }),
    activity: sessionId => call('panel_activity', { sessionId }),
    snapshot: (sessionId, view, streamGeneration, sequence, splitCursors, popupCursor, diagnosticReadSequence) => call('snapshot', { sessionId, view, streamGeneration, sequence, splitCursors, popupCursor, diagnosticReadSequence }),
    tabs: (sessionId, input) => call('tabs', { sessionId, ...input }),
    debugger: (sessionId, input) => call('debugger', { sessionId, ...input }),
    network: (sessionId, input) => call('network', { sessionId, ...input }),
    profile: (sessionId, input) => call('profile', { sessionId, ...input }),
    provider: (sessionId, input) => call('provider', { sessionId, ...input }),
    extensions: (sessionId, input) => call('extensions', { sessionId, ...input }),
    emulate: (sessionId, input) => call('emulate', { sessionId, ...input }),
    liveView: (sessionId, input) => call('live_view', { sessionId, ...input }),
    splitView: (sessionId, input) => call('split_view', { sessionId, ...input }),
    recorder: (sessionId, input) => call('recorder', { sessionId, ...input }),
    close: async (sessionId, view) => { await call('close', { sessionId, view }) },
  }
}
