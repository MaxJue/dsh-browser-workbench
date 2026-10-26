import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { registerAuthenticatedRpc } from './dsh-compat.ts'
import { assertCdpEndpoint } from '../domain/policy.ts'
import { browserChoiceOf, browserSettingsWriteState, writeBrowserChoice } from './config-editor.ts'
import type { BrowserToolChoice } from './config-editor.ts'
import { createBrowserNotice } from './dsh-message.ts'
import type { BrowserControllerSnapshot, BrowserControllerStore } from '../controller/browser-controller.ts'
import type { BrowserRuntime } from '../runtime/runtime.ts'
import type {
  BrowserDebuggerAction,
  BrowserEmulateAction,
  BrowserEmulateInput,
  BrowserExtensionAction,
  BrowserExtensionInput,
  BrowserLiveViewAction,
  BrowserLiveViewInput,
  BrowserNetworkAction,
  BrowserNetworkInput,
  BrowserPanelTabAction,
  BrowserPanelTabInput,
  BrowserPanelView,
  BrowserProfileAction,
  BrowserProfileInput,
  BrowserProviderAction,
  BrowserProviderInput,
  BrowserRecorderAction,
  BrowserRecorderInput,
  BrowserSplitViewAction,
  BrowserSplitViewInput,
} from '../domain/protocol.ts'
import {
  debuggerActions,
  emulateActions,
  extensionActions,
  liveViewActions,
  networkActions,
  panelTabActions,
  panelViews,
  profileActions,
  providerActions,
  recorderActions,
  splitViewActions,
} from '../application/tool-metadata.ts'

export interface BrowserRpcOptions {
  getController: () => BrowserControllerStore | undefined
  getEffectiveToolRegistrationMode: () => 'global' | 'session-select' | 'disabled'
  getConfiguredToolRegistrationMode: () => 'global' | 'session-select' | 'disabled'
  getConfiguredProviderMode: () => 'auto' | 'external'
  getConfiguredExternalEndpoint: () => string | undefined
}

function isBrowserToolChoice(value: unknown): value is BrowserToolChoice {
  return value === 'workbench' || value === 'existing' || value === 'off'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rpcSuccess(value: unknown) {
  return { ok: true as const, value }
}

function rpcFailure(message: string) {
  return { ok: false as const, error: { code: 'internal' as const, message, details: {} } }
}

export function bindBrowserRpc(ctx: Context, runtime: BrowserRuntime, options: BrowserRpcOptions): void {
  ctx.inject(['connection'], (connectionCtx) => {
    return registerAuthenticatedRpc(connectionCtx.connection, '/api/browser-tools', 'browser-tools', async (endpoint, payload) => {
      try {
        if (!isRecord(payload)) return rpcFailure('browser panel requires a payload object')
        const controller = options.getController()
        const effectiveToolRegistrationMode = options.getEffectiveToolRegistrationMode()

        // 设置页的绑定总览不需要 Session 上下文：它列出所有已绑定控制器的 Session。
        if (endpoint === 'controller_overview') {
          const writeState = browserSettingsWriteState(ctx)
          const configuredMode = options.getConfiguredToolRegistrationMode()
          const configuredProviderMode = options.getConfiguredProviderMode()
          return rpcSuccess({
            registrationMode: effectiveToolRegistrationMode,
            configuredMode,
            providerMode: configuredProviderMode,
            choice: browserChoiceOf(configuredMode, configuredProviderMode),
            ...(options.getConfiguredExternalEndpoint() === undefined ? {} : { endpoint: options.getConfiguredExternalEndpoint() }),
            configurable: writeState.configurable,
            ...(writeState.message === undefined ? {} : { configurableMessage: writeState.message }),
            sessions: controller?.list() ?? [],
          })
        }

        // 绑定写回 Profile 补丁并触发热重载，同样不需要 Session 上下文。
        if (endpoint === 'controller_set_browser_choice') {
          if (!isBrowserToolChoice(payload.choice)) return rpcFailure('unknown browser tool choice')
          let externalEndpoint: string | undefined
          if (payload.choice === 'existing') {
            const raw = typeof payload.endpoint === 'string' ? payload.endpoint.trim() : ''
            if (raw === '') return rpcFailure('连接现有 Chrome/Edge 需要填写调试端点，例如 http://127.0.0.1:9222')
            try {
              externalEndpoint = assertCdpEndpoint(raw).href
            } catch (cause) {
              return rpcFailure(cause instanceof Error ? cause.message : String(cause))
            }
          }
          const result = await writeBrowserChoice(ctx, payload.choice, externalEndpoint)
          if (!result.wrote) return rpcFailure(result.message ?? '浏览器绑定未能写回 Profile 补丁')
          return rpcSuccess({ choice: payload.choice })
        }

        if (typeof payload.sessionId !== 'string' || payload.sessionId.trim() === '') return rpcFailure('browser panel requires a non-empty sessionId')
        const sessionId = payload.sessionId

        if (endpoint === 'controller_status') {
          await controller?.waitUntilReady(sessionId)
          const value: BrowserControllerSnapshot & { registrationMode: 'global' | 'session-select' | 'disabled' } = effectiveToolRegistrationMode === 'global'
            ? {
                registrationMode: 'global',
                mode: 'dsh-browser-tools',
                status: 'active',
                generation: 0,
                conflictingTools: [],
                shadowedTools: [],
                restrictedTools: [],
                selectionLocked: true,
                canSwitchNow: false,
                blockers: ['global-registration-mode'],
              }
            : effectiveToolRegistrationMode === 'disabled'
              ? {
                  registrationMode: 'disabled',
                  mode: 'unselected',
                  status: 'inactive',
                  generation: 0,
                  conflictingTools: [],
                  shadowedTools: [],
                  restrictedTools: [],
                  selectionLocked: false,
                  canSwitchNow: false,
                  blockers: ['browser-tools-disabled'],
                }
              : {
                  registrationMode: 'session-select',
                  ...(controller?.snapshot(sessionId) ?? {
                    mode: 'unselected',
                    status: 'inactive',
                    generation: 0,
                    conflictingTools: [],
                    shadowedTools: [],
                    restrictedTools: [],
                    selectionLocked: false,
                    canSwitchNow: false,
                    blockers: ['controller-not-ready'],
                  }),
                }
          return rpcSuccess(value)
        }
        if (endpoint === 'controller_activate' || endpoint === 'controller_select_other' || endpoint === 'controller_release') {
          if (effectiveToolRegistrationMode === 'disabled') return rpcFailure('当前已把浏览器能力交给其他插件，DSH BrowserWorkbench 未注册任何工具')
          if (effectiveToolRegistrationMode !== 'session-select' || controller === undefined) return rpcFailure('当前注册模式不支持按会话选择浏览器工具')
          const agent = ctx.agents.get(SessionId(sessionId))
          if (agent === undefined) return rpcFailure('browser selection requires a live DSH agent session')
          if (agent.session.header.origin === 'subagent') return rpcFailure('delegated sessions cannot select browser tools')
          const result = endpoint === 'controller_activate'
            ? await controller.activate(sessionId)
            : endpoint === 'controller_select_other'
              ? await controller.selectOther(sessionId)
              : await controller.release(sessionId)
          return rpcSuccess({ registrationMode: 'session-select', ...result })
        }
        await controller?.waitUntilReady(sessionId)
        if (effectiveToolRegistrationMode === 'disabled') return rpcFailure('当前已停用 DSH BrowserWorkbench，浏览器面板不可用')
        if (effectiveToolRegistrationMode === 'session-select' && controller?.isActive(sessionId) !== true) {
          return rpcFailure('当前 Session 尚未启用 DSH BrowserWorkbench')
        }
        if (endpoint === 'panel_activity') return rpcSuccess(runtime.panelActivity(sessionId))
        if (endpoint === 'snapshot') {
          const view = payload.view
          if (typeof view !== 'string' || !panelViews.includes(view as BrowserPanelView)) return rpcFailure('unknown browser panel view')
          const streamGeneration = typeof payload.streamGeneration === 'number' ? payload.streamGeneration : undefined
          const sequence = typeof payload.sequence === 'number' ? payload.sequence : undefined
          const splitCursors = isRecord(payload.splitCursors) ? payload.splitCursors as unknown as Parameters<BrowserRuntime['panelSnapshot']>[4] : undefined
          const popupCursor = isRecord(payload.popupCursor) ? payload.popupCursor as unknown as Parameters<BrowserRuntime['panelSnapshot']>[5] : undefined
          const diagnosticReadSequence = typeof payload.diagnosticReadSequence === 'number' ? payload.diagnosticReadSequence : undefined
          return rpcSuccess(await runtime.panelSnapshot(sessionId, view as BrowserPanelView, streamGeneration, sequence, splitCursors, popupCursor, diagnosticReadSequence))
        }
        if (endpoint === 'tabs') {
          if (typeof payload.action !== 'string' || !panelTabActions.includes(payload.action as BrowserPanelTabAction)) return rpcFailure('unknown browser panel tab action')
          const agent = payload.notifyAgent === true && payload.action === 'select' ? ctx.agents.get(SessionId(sessionId)) : undefined
          const session = ctx.sessions.get(SessionId(sessionId))
          const result = await runtime.panelTabs(sessionId, {
            action: payload.action as BrowserPanelTabAction,
            ...(typeof payload.viewId === 'string' ? { viewId: payload.viewId } : {}),
            ...(typeof payload.url === 'string' ? { url: payload.url } : {}),
            ...(payload.notifyAgent === true ? { notifyAgent: true } : {}),
          } satisfies BrowserPanelTabInput, session?.header.createdAt)
          if (agent !== undefined && ctx.agents.get(SessionId(sessionId)) === agent && result.ok && isRecord(result.data) && result.data.changed === true && typeof result.viewId === 'string') {
            const title = typeof result.data.title === 'string' && result.data.title !== '' ? result.data.title : '无标题页'
            const url = typeof result.data.url === 'string' ? result.data.url : 'about:blank'
            try {
              agent.inject(createBrowserNotice(
                `用户已在右侧浏览器中切换活动标签。当前活动标签 viewId=${result.viewId}，标题为“${title}”，URL 为 ${url}。后续浏览器观察和操作请以该标签为准，并在需要精确定位元素时重新获取快照。`,
                `用户切换浏览器标签：${title}`,
              ))
            } catch {}
          }
          return rpcSuccess(result)
        }
        if (endpoint === 'debugger') {
          if (typeof payload.action !== 'string' || !debuggerActions.includes(payload.action as BrowserDebuggerAction)) return rpcFailure('unknown browser debugger action')
          const result = await runtime.panelDebugger(sessionId, {
            action: payload.action as BrowserDebuggerAction,
            ...(typeof payload.viewId === 'string' ? { viewId: payload.viewId } : {}),
            ...(typeof payload.url === 'string' ? { url: payload.url } : {}),
            ...(typeof payload.lineNumber === 'number' ? { lineNumber: payload.lineNumber } : {}),
            ...(typeof payload.columnNumber === 'number' ? { columnNumber: payload.columnNumber } : {}),
            ...(typeof payload.breakpointId === 'string' ? { breakpointId: payload.breakpointId } : {}),
            ...(typeof payload.callFrameId === 'string' ? { callFrameId: payload.callFrameId } : {}),
            ...(typeof payload.scopeNumber === 'number' ? { scopeNumber: payload.scopeNumber } : {}),
            ...(typeof payload.scriptId === 'string' ? { scriptId: payload.scriptId } : {}),
          })
          return rpcSuccess(result)
        }
        if (endpoint === 'network') {
          if (typeof payload.action !== 'string' || !networkActions.includes(payload.action as BrowserNetworkAction)) return rpcFailure('unknown browser network action')
          return rpcSuccess(await runtime.panelNetwork(sessionId, payload as unknown as BrowserNetworkInput))
        }
        if (endpoint === 'profile') {
          if (typeof payload.action !== 'string' || !profileActions.includes(payload.action as BrowserProfileAction)) return rpcFailure('unknown browser profile action')
          return rpcSuccess(await runtime.panelProfile(sessionId, payload as unknown as BrowserProfileInput))
        }
        if (endpoint === 'provider') {
          if (typeof payload.action !== 'string' || !providerActions.includes(payload.action as BrowserProviderAction)) return rpcFailure('unknown browser provider action')
          return rpcSuccess(await runtime.panelProvider(sessionId, payload as unknown as BrowserProviderInput))
        }
        if (endpoint === 'emulate') {
          if (typeof payload.action !== 'string' || !emulateActions.includes(payload.action as BrowserEmulateAction)) return rpcFailure('unknown browser emulation action')
          return rpcSuccess(await runtime.panelEmulate(sessionId, payload as unknown as BrowserEmulateInput))
        }
        if (endpoint === 'live_view') {
          if (typeof payload.action !== 'string' || !liveViewActions.includes(payload.action as BrowserLiveViewAction)) return rpcFailure('unknown browser live view action')
          const agent = payload.notifyAgent === true ? ctx.agents.get(SessionId(sessionId)) : undefined
          const result = await runtime.panelLiveView(sessionId, payload as unknown as BrowserLiveViewInput)
          if (agent !== undefined && ctx.agents.get(SessionId(sessionId)) === agent && result.ok && isRecord(result.data) && result.data.changed === true && (payload.action === 'standard' || payload.action === 'adaptive')) {
            const mode = payload.action === 'standard' ? '标准比例' : '自适应比例'
            try {
              agent.inject(createBrowserNotice(
                `用户已将右侧浏览器实况切换为${mode}模式。标准模式固定为 1280×720 并优先保证页面元素完整；自适应模式会让真实浏览器 Viewport 跟随右侧区域，以减少黑边并方便人工观察与操作。请基于当前模式继续工作。`,
                `用户将浏览器实况切换为${mode}模式`,
              ))
            } catch {}
          }
          return rpcSuccess(result)
        }
        if (endpoint === 'split_view') {
          if (typeof payload.action !== 'string' || !splitViewActions.includes(payload.action as BrowserSplitViewAction)) return rpcFailure('unknown browser split view action')
          const agent = payload.notifyAgent === true ? ctx.agents.get(SessionId(sessionId)) : undefined
          const result = await runtime.panelSplitView(sessionId, payload as unknown as BrowserSplitViewInput)
          if (agent !== undefined && ctx.agents.get(SessionId(sessionId)) === agent && result.ok && isRecord(result.data) && result.data.changed === true) {
            try {
              const orientationLabel = result.data.orientation === 'left-right' ? '左右' : '上下'
              agent.inject(createBrowserNotice(
                `用户已调整右侧浏览器${orientationLabel}双页分屏。当前状态：${result.data.enabled === true ? `已开启，第一窗格占比 ${Math.round(Number(result.data.ratio) * 100)}%` : '已关闭'}；当前焦点标签 viewId=${result.viewId ?? 'none'}。后续未显式提供 viewId 的浏览器工具将操作当前焦点标签。`,
                `用户调整浏览器${orientationLabel}分屏`,
              ))
            } catch {}
          }
          return rpcSuccess(result)
        }
        if (endpoint === 'extensions') {
          if (typeof payload.action !== 'string' || !extensionActions.includes(payload.action as BrowserExtensionAction)) return rpcFailure('unknown browser extension action')
          return rpcSuccess(await runtime.panelExtensions(sessionId, payload as unknown as BrowserExtensionInput))
        }
        if (endpoint === 'recorder') {
          if (typeof payload.action !== 'string' || !recorderActions.includes(payload.action as BrowserRecorderAction)) return rpcFailure('unknown browser recorder action')
          if (payload.mode !== undefined && payload.mode !== 'rolling' && payload.mode !== 'deep') return rpcFailure('browser recorder mode must be rolling or deep')
          return rpcSuccess(await runtime.panelRecorder(sessionId, {
            action: payload.action as BrowserRecorderAction,
            ...(payload.mode === 'rolling' || payload.mode === 'deep' ? { mode: payload.mode } : {}),
            ...(typeof payload.incidentId === 'string' ? { incidentId: payload.incidentId } : {}),
          } satisfies BrowserRecorderInput))
        }
        if (endpoint === 'close') {
          const view = payload.view
          if (typeof view !== 'string' || !panelViews.includes(view as BrowserPanelView)) return rpcFailure('unknown browser panel view')
          await runtime.panelClose(sessionId, view as BrowserPanelView)
          return rpcSuccess(null)
        }
        return rpcFailure(`unknown browser tools endpoint: ${endpoint}`)
      } catch (error) {
        return rpcFailure(error instanceof Error ? error.message : String(error))
      }
    })
  })
}
