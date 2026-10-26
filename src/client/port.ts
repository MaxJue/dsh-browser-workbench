import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {
  BrowserControllerSnapshot,
  BrowserDebuggerInput,
  BrowserEmulateInput,
  BrowserExtensionInput,
  BrowserFrameCursor,
  BrowserInputTraceUpdate,
  BrowserLiveViewInput,
  BrowserNetworkInput,
  BrowserPanelSnapshot,
  BrowserPanelTabInput,
  BrowserPanelView,
  BrowserProfileInput,
  BrowserProviderInput,
  BrowserRecorderInput,
  BrowserSplitViewInput,
  BrowserSplitViewPane,
  BrowserTakeoverInput,
  BrowserUserInput,
} from '../domain/protocol.ts'
import { valueOf } from './panel-model.ts'

export const CHANNEL = '/api'
export const RPC_METHOD = 'browser-tools'

export interface Port {
  controllerStatus(sessionId: string): Promise<BrowserControllerSnapshot>
  controllerActivate(sessionId: string): Promise<BrowserControllerSnapshot>
  controllerSelectOther(sessionId: string): Promise<BrowserControllerSnapshot>
  controllerRelease(sessionId: string): Promise<BrowserControllerSnapshot>
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
  takeover(sessionId: string, input: BrowserTakeoverInput): Promise<unknown>
  input(sessionId: string, input: BrowserUserInput): Promise<unknown>
  inputTrace(sessionId: string, input: BrowserInputTraceUpdate): Promise<unknown>
  recorder(sessionId: string, input: BrowserRecorderInput): Promise<unknown>
  close(sessionId: string, view: BrowserPanelView): Promise<void>
}

export function createPort(connection: ConnectionHandle): Port {
  const call = async <T>(endpoint: string, payload: unknown): Promise<T> => {
    return valueOf<T>(await connection.rpc.call(CHANNEL, RPC_METHOD, { endpoint, payload }))
  }

  return {
    controllerStatus: sessionId => call('controller_status', { sessionId }),
    controllerActivate: sessionId => call('controller_activate', { sessionId }),
    controllerSelectOther: sessionId => call('controller_select_other', { sessionId }),
    controllerRelease: sessionId => call('controller_release', { sessionId }),
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
    takeover: (sessionId, input) => call('takeover', { sessionId, ...input }),
    input: (sessionId, input) => call('input', { sessionId, ...input }),
    inputTrace: (sessionId, input) => call('input_trace', { sessionId, ...input }),
    recorder: (sessionId, input) => call('recorder', { sessionId, ...input }),
    close: async (sessionId, view) => { await call('close', { sessionId, view }) },
  }
}
