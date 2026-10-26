import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { resolveConfig } from './domain/policy.ts'
import { BrowserControllerStore } from './controller/browser-controller.ts'
import { BrowserRuntime } from './runtime/runtime.ts'
import type { Config as BrowserConfig } from './domain/types.ts'
import { defineBrowserTools, registerToolDefinitions } from './application/browser-tools.ts'
import { bindBrowserSafetyPolicy } from './application/security-policy.ts'
import { bindBrowserRpc } from './compat/rpc-dispatcher.ts'

export { Config } from './application/config.ts'

export const name = 'dsh-browser-workbench'
export const inject = ['tools', 'attachments', 'agents', 'sessions', 'permissionPresets']

declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: HostConnectionHandle
  }
}

export function apply(ctx: Context, config: BrowserConfig): void {
  const resolved = resolveConfig(config)
  const runtime = new BrowserRuntime(resolved, ctx.attachments)
  const definitions = defineBrowserTools(runtime)
  // 实际注册模式允许在发现现有浏览器工具后从 global 安全降级；RPC、审批与执行归属必须统一读取该值，禁止配置值与运行时行为分叉。
  let effectiveToolRegistrationMode = resolved.toolRegistrationMode
  let controller: BrowserControllerStore | undefined

  // 绑定 /api/browser-tools RPC 路由，随 connection 注入和卸载
  bindBrowserRpc(ctx, runtime, {
    getController: () => controller,
    getEffectiveToolRegistrationMode: () => effectiveToolRegistrationMode,
  })

  // 绑定生命周期释放、Agent disposed 监听与 Pre-execute 审批策略
  bindBrowserSafetyPolicy(ctx, runtime, {
    definitions,
    getController: () => controller,
    getEffectiveToolRegistrationMode: () => effectiveToolRegistrationMode,
    subagentInteractive: resolved.subagentInteractive,
  })

  const existingBrowserTools = ctx.tools.schemas()
    .map(definition => definition.name)
    .filter(toolName => toolName.startsWith('browser_'))
  if (effectiveToolRegistrationMode === 'global' && existingBrowserTools.length > 0) {
    // 其他浏览器插件先注册时，抛错会让 Cordis 拒绝整棵插件树并锁死 DSH 启动。
    // 安全降级只改变 BrowserWorkbench 的注册层级：现有工具继续全局可用，本插件保持未激活，待用户按 Session 显式选择。
    effectiveToolRegistrationMode = 'session-select'
  }

  if (effectiveToolRegistrationMode === 'global') {
    registerToolDefinitions(ctx, definitions)
  } else {
    controller = new BrowserControllerStore({
      ctx,
      storageRoot: resolved.controllerStorageRoot,
      config: resolved.sessionController,
      toolDefinitions: definitions,
      registerTools: (agent, values) => registerToolDefinitions(agent.ctx, values),
      releaseRuntime: (sessionId, sessionCreatedAt) => runtime.disposeSession({ sessionId, sessionCreatedAt }),
      isOwnedTool: toolName => definitions.some(definition => definition.name === toolName),
    })
    // Runtime 只通过只读 resolver 获取当前 Session 的控制器代际，不反向持有 Store。
    // 未激活 Session 返回 undefined，防止 other 模式生成被误标为本插件所有的 L3 证据。
    runtime.setControllerIdentityResolver(sessionId => controller?.identity(sessionId))
    // 插件可能在部分 Agent 已创建后热加载；先绑定现有 Agent，再监听后续创建，
    // 避免必须重启 DSH 才能使用 session-select。
    for (const agent of ctx.agents.list()) controller.attach(agent)
    ctx.on('agent/created', ({ agent }) => { controller?.attach(agent) })
  }
}

export type { BrowserConfig }
