import { BrowserError } from '../domain/errors.ts'
import type { Identity, ToolOutput } from '../domain/types.ts'
import type { BrowserDebuggerAction, BrowserDiagnoseAction, BrowserEmulateAction, BrowserEvaluateAction, BrowserExtensionAction, BrowserLiveViewAction, BrowserNetworkAction, BrowserPanelTabAction, BrowserPanelView, BrowserProfileAction, BrowserProviderAction, BrowserRecorderAction, BrowserSplitViewAction, BrowserTakeoverAction } from '../domain/protocol.ts'
import type { ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

export const outputSchema = { type: 'object' as const, additionalProperties: false, properties: { ok: { type: 'boolean' as const, required: true as const }, action: { type: 'string' as const, required: true as const }, viewId: { type: 'string' as const }, data: { type: 'json' as const } } } satisfies ValueSchemaSpec

export function identity(exec: ToolRunContext): Identity {
  const session = exec.agent?.session
  if (session === undefined) throw new BrowserError('browser tools require a DSH agent session', 'AGENT_REQUIRED')
  return { sessionId: String(session.id), sessionCreatedAt: session.header.createdAt, callId: String(exec.callId), rootCallId: String(exec.rootCallId), toolName: exec.name }
}

export function render(_args: unknown, value: ToolOutput) {
  return [{ type: 'text' as const, text: JSON.stringify(value) }]
}

export const debuggerActions: BrowserDebuggerAction[] = ['attach', 'detach', 'pause', 'resume', 'step_over', 'step_into', 'step_out', 'call_frames', 'scripts', 'script_source', 'source_map', 'scope_variables', 'set_breakpoint', 'remove_breakpoint']
export const diagnoseActions: BrowserDiagnoseAction[] = ['start', 'status', 'inspect', 'checkpoint', 'compare', 'report', 'stop', 'recorder_status', 'recorder_start', 'recorder_pause', 'recorder_resume', 'recorder_clear', 'recorder_stop', 'recorder_mark', 'recorder_complete', 'recorder_timeline']
export const recorderActions: BrowserRecorderAction[] = ['status', 'start', 'pause', 'resume', 'clear', 'stop', 'mark', 'complete']
export const networkActions: BrowserNetworkAction[] = ['enable', 'disable', 'list_paused', 'continue', 'abort', 'fulfill', 'body', 'replay']
export const verificationGuidance = 'If the page shows CAPTCHA, human verification, SMS or email verification codes, Passkey/WebAuthn, device confirmation, or another security challenge, stop automated interaction immediately, do not bypass or submit the challenge, tell the user what is visible, and request human takeover.'
export const profileActions: BrowserProfileAction[] = ['trace_start', 'trace_stop', 'playwright_trace_start', 'playwright_trace_stop', 'cpu_start', 'cpu_stop', 'coverage_start', 'coverage_stop', 'heap_snapshot', 'heap_sampling_start', 'heap_sampling_stop', 'artifacts', 'artifact_read']
export const providerChoices = ['external-cdp'] as const
export const extensionChoices = ['list'] as const
export const emulateActions: BrowserEmulateAction[] = ['viewport', 'device', 'locale', 'timezone', 'network', 'cpu', 'offline', 'permissions', 'reset']
export const evaluateActions: BrowserEvaluateAction[] = ['isolated', 'main_world', 'paused_frame']
export const providerActions: BrowserProviderAction[] = ['list', 'connect', 'disconnect', 'capabilities']
export const extensionActions: BrowserExtensionAction[] = ['list', 'install', 'enable', 'disable', 'uninstall', 'apply', 'open_popup', 'close_popup']
export const takeoverActions: BrowserTakeoverAction[] = ['status', 'request', 'return', 'cancel']
export const liveViewActions: BrowserLiveViewAction[] = ['status', 'standard', 'adaptive', 'initialize', 'resize']
export const splitViewActions: BrowserSplitViewAction[] = ['status', 'open', 'close', 'swap', 'assign', 'focus', 'ratio', 'orientation', 'resize']
export const panelTabActions: BrowserPanelTabAction[] = ['new', 'select', 'close', 'back', 'forward', 'reload', 'navigate']
export const panelViews: BrowserPanelView[] = ['live', 'diagnostic', 'console', 'network', 'debugger', 'performance', 'provider', 'extensions', 'emulation']
