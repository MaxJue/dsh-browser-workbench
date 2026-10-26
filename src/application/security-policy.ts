import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { BrowserControllerStore } from '../controller/browser-controller.ts'
import type { BrowserRuntime } from '../runtime/runtime.ts'

export interface BrowserSafetyPolicyOptions {
  definitions: readonly ToolDefinition[]
  getController: () => BrowserControllerStore | undefined
  getEffectiveToolRegistrationMode: () => 'global' | 'session-select' | 'disabled'
  subagentInteractive: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function bindBrowserSafetyPolicy(ctx: Context, runtime: BrowserRuntime, options: BrowserSafetyPolicyOptions): void {
  ctx.effect(() => async () => runtime.dispose(), 'browser.dispose()')

  ctx.on('agent/disposed', ({ agent }) => {
    // 同一正式 Session 的 Agent Scope 可能由 DSH 原地替换。必须先让 Controller Store
    // 精确解除旧 Agent，再检查注册表；若新 Agent 已接管同一 Session，则保留 Runtime Session，
    // 避免旧 disposed 事件误关新 Scope 正在使用的 BrowserContext、页面和调试状态。
    void (async () => {
      await options.getController()?.detach(agent)
      const sessionId = String(agent.session.id)
      const replacement = ctx.agents.get(SessionId(sessionId))
      if (replacement !== undefined && replacement !== agent) return
      await runtime.disposeSession({ sessionId, sessionCreatedAt: agent.session.header.createdAt })
    })().catch(() => {})
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    const sessionId = exec.agent === undefined ? undefined : String(exec.agent.session.id)
    const owned = options.definitions.some(definition => definition.name === exec.name)
      && (options.getEffectiveToolRegistrationMode() === 'global' || options.getController()?.ownsExecution(sessionId, exec.name) === true)
    // 第三方工具即使使用 browser_* 前缀，也不属于本插件的 Approval 与 Subagent 策略。
    if (!owned) return next()

    const child = exec.agent?.session.header.origin === 'subagent'
    const debuggerMutation = exec.name === 'browser_debugger' && isRecord(exec.arguments) && /^(detach|pause|resume|step_over|step_into|step_out|set_breakpoint|remove_breakpoint)$/.test(String(exec.arguments.action))
    const debuggerSensitiveRead = exec.name === 'browser_debugger' && isRecord(exec.arguments) && /^(script_source|source_map)$/.test(String(exec.arguments.action))
    const diagnoseSensitiveRead = exec.name === 'browser_diagnose' && isRecord(exec.arguments) && exec.arguments.action === 'report'
    const recorderMutation = exec.name === 'browser_diagnose' && isRecord(exec.arguments) && /^recorder_(start|pause|resume|clear|stop|mark|complete)$/.test(String(exec.arguments.action))
    const networkSensitive = exec.name === 'browser_network_control' && isRecord(exec.arguments) && exec.arguments.action !== 'list_paused'
    const profileSensitive = exec.name === 'browser_profile' && isRecord(exec.arguments) && exec.arguments.action !== 'artifacts'
    const providerMutation = exec.name === 'browser_provider' && isRecord(exec.arguments) && /^(connect|disconnect)$/.test(String(exec.arguments.action))
    const extensionMutation = exec.name === 'browser_extensions' && isRecord(exec.arguments) && exec.arguments.action !== 'list'
    const emulateMutation = exec.name === 'browser_emulate'
    const liveViewMutation = exec.name === 'browser_live_view' && isRecord(exec.arguments) && exec.arguments.action !== 'status'
    const splitViewMutation = exec.name === 'browser_split_view' && isRecord(exec.arguments) && exec.arguments.action !== 'status'
    // 隔离世界仍共享页面 DOM 并可发起网络请求，因此任意 JavaScript 求值都不能按只读能力放行。
    const evaluateSensitive = exec.name === 'browser_evaluate'
    const takeoverMutation = exec.name === 'browser_takeover' && isRecord(exec.arguments) && exec.arguments.action !== 'status'
    const v2Sensitive = debuggerSensitiveRead || diagnoseSensitiveRead || recorderMutation || networkSensitive || profileSensitive || providerMutation || extensionMutation || emulateMutation || evaluateSensitive || takeoverMutation
    // 空白页签不访问外部地址，继续免审批；携带非空 URL 的 new 与 browser_navigate 具有相同导航副作用。
    const tabNavigation = exec.name === 'browser_tabs' && isRecord(exec.arguments) && exec.arguments.action === 'new' && typeof exec.arguments.url === 'string' && exec.arguments.url.trim() !== '' && exec.arguments.url.trim() !== 'about:blank'
    // 导航、对话框与指针交互同样改变页面状态（并可能触发外部网络副作用），属于交互能力。
    const navigationMutation = exec.name === 'browser_navigate' || exec.name === 'browser_navigate_back' || exec.name === 'browser_handle_dialog'
    const pointerInteraction = exec.name === 'browser_hover' || exec.name === 'browser_scroll'
    const session = exec.agent?.session
    const permissionPreset = session === undefined ? undefined : ctx.permissionPresets.current(session)

    if (child && !options.subagentInteractive && (exec.name === 'browser_diagnose' || debuggerMutation || liveViewMutation || splitViewMutation || v2Sensitive || navigationMutation || pointerInteraction || tabNavigation || /^(browser_click|browser_type|browser_press_key|browser_select_option|browser_upload_file|browser_download)$/.test(exec.name))) {
      return { kind: 'deny', reason: `delegated browser session cannot use ${exec.name}` }
    }
    if (child) return { kind: 'allow' }
    if (debuggerMutation || v2Sensitive || tabNavigation || /^(browser_navigate|browser_click|browser_type|browser_press_key|browser_select_option|browser_handle_dialog|browser_upload_file|browser_download)$/.test(exec.name)) {
      if (permissionPreset === 'danger-full-access') {
        // DSH Full access 使用 approval/policy=never 关闭审批提示；顶层插件工具必须在进入 Approval 前直接放行，否则 ask 会被无弹窗解释为用户拒绝。
        return { kind: 'allow' }
      }
      if (extensionMutation && isRecord(exec.arguments)) {
        const action = String(exec.arguments.action)
        const target = typeof exec.arguments.extension === 'string'
          ? exec.arguments.extension
          : typeof exec.arguments.extensionId === 'string'
            ? exec.arguments.extensionId
            : 'current Session extensions'
        const applyMode = exec.arguments.applyMode === 'now' ? 'immediately rebuild the browser' : 'apply on the next browser start'
        return { kind: 'ask', reason: `browser_extensions ${action} targets ${target} and will ${applyMode}` }
      }
      return { kind: 'ask', reason: `${exec.name} changes browser or host state` }
    }
    return { kind: 'allow' }
  })
}

