import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ParameterSchemaSpec, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createBrowserNotice } from '../compat/dsh-message.ts'
import type { ToolOutput } from '../domain/types.ts'
import type {
  BrowserDebuggerInput,
  BrowserDiagnoseInput,
  BrowserEmulateInput,
  BrowserEvaluateInput,
  BrowserExtensionInput,
  BrowserLiveViewInput,
  BrowserNetworkInput,
  BrowserProfileInput,
  BrowserProviderInput,
  BrowserSplitViewInput,
  BrowserTakeoverInput,
} from '../domain/protocol.ts'
import {
  debuggerActions,
  diagnoseActions,
  emulateActions,
  evaluateActions,
  extensionChoices,
  identity,
  networkActions,
  outputSchema,
  profileActions,
  providerActions,
  providerChoices,
  render as renderOutput,
  takeoverActions,
  verificationGuidance,
} from './tool-metadata.ts'
import type { BrowserRuntime } from '../runtime/runtime.ts'

function render(_args: unknown, value: ToolOutput) {
  return renderOutput(_args, value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tool<const P extends ParameterSchemaSpec>(
  definitions: ToolDefinition[],
  options: {
    name: string
    description: string
    parameters: P
    execute: (args: Record<string, unknown>, exec: ToolRunContext) => Promise<ToolOutput>
  },
): void {
  definitions.push(defineTool({
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    output: { schema: outputSchema, render },
    execute: options.execute,
  }))
}

export function registerToolDefinitions(ctx: Context, definitions: readonly ToolDefinition[]): () => void {
  const disposers: Array<() => void> = []
  try {
    for (const definition of definitions) disposers.push(ctx.tools.register(definition))
  } catch (error) {
    for (const dispose of disposers.reverse()) {
      try { dispose() } catch {}
    }
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) {
      try { dispose() } catch {}
    }
  }
}

export function defineBrowserTools(runtime: BrowserRuntime): ToolDefinition[] {
  const definitions: ToolDefinition[] = []

  tool(definitions, {
    name: 'browser_tabs',
    description: 'Manage tabs in the current DSH session. action defaults to list. new without url, with an empty url, or with about:blank creates a blank tab. select and close accept either stable viewId or current list index.',
    parameters: {
      action: { type: 'string', enum: ['list', 'new', 'select', 'close'] },
      viewId: { type: 'string' },
      index: { type: 'integer' },
      url: { type: 'string' },
    },
    execute: (args, exec) => runtime.tabs(identity(exec), exec.signal, args as { action?: string; viewId?: string; index?: number; url?: string }),
  })

  tool(definitions, {
    name: 'browser_navigate',
    description: `Navigate the active browser tab, or viewId when provided, to a complete http/https URL after policy and approval checks. If the debugger paused the page, resume it first. ${verificationGuidance}`,
    parameters: { url: { type: 'string', required: true }, viewId: { type: 'string' }, timeoutMs: { type: 'integer' } },
    execute: (args, exec) => runtime.navigate(identity(exec), exec.signal, args as { url: string; viewId?: string; timeoutMs?: number }),
  })

  tool(definitions, {
    name: 'browser_navigate_back',
    description: 'Navigate the active browser tab, or viewId when provided, back in history.',
    parameters: { viewId: { type: 'string' }, timeoutMs: { type: 'integer' } },
    execute: (args, exec) => runtime.navigateBack(identity(exec), exec.signal, args as { viewId?: string; timeoutMs?: number }),
  })

  tool(definitions, {
    name: 'browser_snapshot',
    description: `Return a compact ARIA snapshot and refreshed short-lived element refs for the active tab, or viewId when provided. The first call after navigation returns full ARIA; later calls automatically return refreshed refs plus a bounded diff when that is smaller. Pass includeDiff=false to force a full snapshot. maxNodes defaults to 80 and is capped at 300. Take a new snapshot whenever a tool returns STALE_REF. ${verificationGuidance}`,
    parameters: { viewId: { type: 'string' }, includeDiff: { type: 'boolean' }, maxNodes: { type: 'integer' } },
    execute: (args, exec) => runtime.snapshot(identity(exec), exec.signal, args as { viewId?: string; includeDiff?: boolean; maxNodes?: number }),
  })

  const element = { ref: { type: 'string', required: true }, viewId: { type: 'string' }, timeoutMs: { type: 'integer' } } as const
  for (const [name, action, description] of [
    ['browser_click', 'click', `Click an element identified by a current browser snapshot or browser_query refs result. The result reports whether URL, document generation, or bounded DOM structure changed; changed=false means the event was dispatched but no immediate page change was observed, so take a new snapshot before retrying. ${verificationGuidance}`],
    ['browser_hover', 'hover', 'Hover an element identified by a current browser snapshot ref.'],
    ['browser_scroll', 'scroll', 'Scroll an element ref into view. For page scrolling omit ref and provide direction, amount, deltaX, or deltaY.'],
  ] as const) {
    const parameters = action === 'scroll'
      ? { ref: { type: 'string' }, viewId: { type: 'string' }, timeoutMs: { type: 'integer' }, direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer' }, deltaX: { type: 'integer' }, deltaY: { type: 'integer' } } as const
      : element
    tool(definitions, { name, description, parameters, execute: (args, exec) => runtime.elementAction(identity(exec), exec.signal, { ...(args as { ref?: string; viewId?: string; timeoutMs?: number; direction?: string; amount?: number; deltaX?: number; deltaY?: number }), action }) })
  }

  tool(definitions, {
    name: 'browser_type',
    description: `Type into an editable snapshot ref. clear defaults to true; submit presses Enter afterwards; slowly types with a short per-character delay. Never enter or submit a security verification challenge. ${verificationGuidance}`,
    parameters: { ...element, text: { type: 'string', required: true }, clear: { type: 'boolean' }, submit: { type: 'boolean' }, slowly: { type: 'boolean' } },
    execute: (args, exec) => runtime.elementAction(identity(exec), exec.signal, { ...(args as { ref: string; viewId?: string; timeoutMs?: number; text: string; clear?: boolean; submit?: boolean; slowly?: boolean }), action: 'type' }),
  })

  tool(definitions, {
    name: 'browser_press_key',
    description: `Press a keyboard key on the active page. Omit ref or pass an empty ref to target the current page focus; provide a non-empty ref only for one current snapshot element. ${verificationGuidance}`,
    parameters: { ref: { type: 'string' }, viewId: { type: 'string' }, timeoutMs: { type: 'integer' }, key: { type: 'string', required: true } },
    execute: (args, exec) => runtime.elementAction(identity(exec), exec.signal, { ...(args as { ref?: string; viewId?: string; timeoutMs?: number; key: string }), action: 'press_key' }),
  })

  tool(definitions, {
    name: 'browser_select_option',
    description: 'Select options on a select element identified by a current snapshot ref.',
    parameters: { ...element, values: { type: 'array', items: { type: 'string' }, required: true } },
    execute: (args, exec) => runtime.elementAction(identity(exec), exec.signal, { ...(args as { ref: string; viewId?: string; timeoutMs?: number; values: string[] }), action: 'select_option' }),
  })

  tool(definitions, {
    name: 'browser_wait_for',
    description: `Wait on the active tab for non-empty text, text disappearance, positive seconds, positive milliseconds, or a load state. Empty strings and zero time values are ignored. With no effective condition, waits for domcontentloaded. Do not provide both positive time and positive timeMs. ${verificationGuidance}`,
    parameters: { viewId: { type: 'string' }, text: { type: 'string' }, textGone: { type: 'string' }, state: { type: 'string', enum: ['visible', 'hidden', 'domcontentloaded', 'networkidle'] }, time: { type: 'number' }, timeMs: { type: 'integer' }, timeoutMs: { type: 'integer' } },
    execute: (args, exec) => runtime.waitFor(identity(exec), exec.signal, args as { viewId?: string; text?: string; textGone?: string; state?: string; time?: number; timeMs?: number; timeoutMs?: number }),
  })

  definitions.push(defineTool({
    name: 'browser_take_screenshot',
    description: 'Capture a PNG screenshot and save it through the DSH attachment store.',
    parameters: { viewId: { type: 'string' }, fullPage: { type: 'boolean' } },
    output: { schema: outputSchema, render(_args, value) { return [{ type: 'text', text: JSON.stringify(value) }, { type: 'image', attachment: value.data as unknown as ImageAttachmentRef }] } },
    async execute(args, exec) { return runtime.screenshot(identity(exec), exec.signal, args) },
  }))

  tool(definitions, {
    name: 'browser_get_attribute',
    description: 'Read one non-sensitive attribute from an element ref.',
    parameters: { ref: { type: 'string', required: true }, name: { type: 'string', required: true }, viewId: { type: 'string' } },
    execute: (args, exec) => runtime.getAttribute(identity(exec), exec.signal, args as { ref: string; name: string; viewId?: string }),
  })

  tool(definitions, {
    name: 'browser_query',
    description: `Run a bounded selector query without executing page JavaScript supplied by the model. field=refs returns short-lived refs for visible named matches and invalidates older refs. frameId may target one attached same-origin Frame from browser_diagnose status; cross-origin and OOPIF element queries fail closed. ${verificationGuidance}`,
    parameters: { selector: { type: 'string', required: true }, field: { type: 'string', enum: ['count', 'text', 'visible', 'attribute', 'refs'], required: true }, attribute: { type: 'string' }, limit: { type: 'integer' }, viewId: { type: 'string' }, frameId: { type: 'string' } },
    execute: (args, exec) => runtime.query(identity(exec), exec.signal, args as { selector: string; field: string; attribute?: string; limit?: number; viewId?: string; frameId?: string }),
  })

  tool(definitions, {
    name: 'browser_console_messages',
    description: 'Read bounded page console messages captured for the selected tab.',
    parameters: { viewId: { type: 'string' }, clear: { type: 'boolean' } },
    execute: (args, exec) => runtime.consoleMessages(identity(exec), exec.signal, args as { viewId?: string; clear?: boolean }),
  })

  tool(definitions, {
    name: 'browser_network_requests',
    description: 'Read bounded, URL-redacted network request metadata for the selected tab.',
    parameters: { viewId: { type: 'string' }, clear: { type: 'boolean' } },
    execute: (args, exec) => runtime.networkRequests(identity(exec), exec.signal, args as { viewId?: string; clear?: boolean }),
  })

  tool(definitions, {
    name: 'browser_handle_dialog',
    description: `Resolve an ordinary open dialog or preconfigure the next alert, confirm, or prompt. Do not accept, answer, or preconfigure a dialog that is part of a security verification challenge. ${verificationGuidance}`,
    parameters: { accept: { type: 'boolean', required: true }, promptText: { type: 'string' }, viewId: { type: 'string' } },
    execute: (args, exec) => runtime.handleDialog(identity(exec), exec.signal, args as { accept: boolean; promptText?: string; viewId?: string }),
  })

  tool(definitions, {
    name: 'browser_upload_file',
    description: 'Upload one file from configured roots without returning its host absolute path.',
    parameters: { ref: { type: 'string', required: true }, filePath: { type: 'string', required: true }, viewId: { type: 'string' } },
    execute: (args, exec) => runtime.upload(identity(exec), exec.signal, args as { ref: string; filePath: string; viewId?: string }),
  })

  tool(definitions, {
    name: 'browser_download',
    description: 'Click a download element and save the result in the plugin-managed artifact directory.',
    parameters: { ref: { type: 'string', required: true }, viewId: { type: 'string' }, timeoutMs: { type: 'integer' } },
    execute: (args, exec) => runtime.download(identity(exec), exec.signal, args as { ref: string; viewId?: string; timeoutMs?: number }),
  })

  tool(definitions, {
    name: 'browser_debugger',
    description: 'Control the active browser tab JavaScript debugger. Use attach first; call_frames and scope_variables are read-only. Pause, resume, stepping, breakpoint changes, and detach require approval.',
    parameters: {
      action: { type: 'string', enum: debuggerActions, required: true },
      viewId: { type: 'string' },
      url: { type: 'string' },
      lineNumber: { type: 'integer' },
      columnNumber: { type: 'integer' },
      breakpointId: { type: 'string' },
      callFrameId: { type: 'string' },
      scopeNumber: { type: 'integer' },
      scriptId: { type: 'string' },
    },
    execute: (args, exec) => runtime.debugger(identity(exec), exec.signal, args as unknown as BrowserDebuggerInput),
  })

  tool(definitions, {
    name: 'browser_diagnose',
    description: 'Create a bounded frontend debugging evidence chain for the selected tab. start binds one view and enables L3 context identity collection. recorder_start explicitly enables privacy-preserving Rolling or Deep recording; the default remains Off. recorder_status/timeline are read-only, while pause/resume/clear/stop/mark/complete change recorder state. Rolling keeps up to 180 seconds of redacted interaction metadata without a persistent Live View recording banner; Deep is explicit and visibly marked in the panel. Input text, passwords, verification codes, cookies, authorization, clipboard contents, and file contents are never stored in recorder events. Fixing the primary root cause is not completion: before reporting success, verify cancellation and stale async work, controlled handling of business non-2xx responses, zero remaining page runtime errors, and a successful comparable checkpoint comparison without new critical regressions. Expected AbortError must not remain as a page error, and a failed or unavailable Compare must not be replaced by a manual success claim. When acceptance logic combines scope, identity, and ordering fields (revision/version/generation/epoch/sequence), do not infer monotonicity from same-identity tests alone. Before claiming closure, cover identity unchanged/changed × order equal/higher/lower × owner/context current/stale. Keep unspecified combinations unverified; evidence claims must not exceed the demonstrated relations. inspect, checkpoint, compare, report, and stop retain their existing semantics. It never modifies Workspace files, reads Network bodies, bypasses cross-origin restrictions, or executes model-supplied JavaScript.',
    parameters: {
      action: { type: 'string', enum: diagnoseActions, required: true },
      viewId: { type: 'string' },
      ref: { type: 'string' },
      label: { type: 'string' },
      checkpointId: { type: 'string' },
      beforeCheckpointId: { type: 'string' },
      afterCheckpointId: { type: 'string' },
      screenshot: { type: 'boolean' },
      sinceActionId: { type: 'string' },
      untilActionId: { type: 'string' },
      sinceCheckpointId: { type: 'string' },
      sinceCursor: { type: 'integer' },
      recorderMode: { type: 'string', enum: ['rolling', 'deep'] },
      incidentId: { type: 'string' },
      limit: { type: 'integer' },
    },
    execute: (args, exec) => runtime.diagnose(identity(exec), exec.signal, args as unknown as BrowserDiagnoseInput),
  })

  tool(definitions, {
    name: 'browser_network_control',
    description: 'Control bounded Fetch interception for the selected tab. list_paused is read-only. Other actions require approval. Paused requests automatically continue after the configured timeout. body stores large content as a managed artifact; replay can only repeat the selected paused request.',
    parameters: {
      action: { type: 'string', enum: networkActions, required: true },
      viewId: { type: 'string' },
      requestId: { type: 'string' },
      urlPattern: { type: 'string' },
      resourceType: { type: 'string' },
      requestStage: { type: 'string', enum: ['request', 'response', 'both'] },
      errorReason: { type: 'string' },
      responseCode: { type: 'integer' },
      responsePhrase: { type: 'string' },
      headers: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true },
            value: { type: 'string', required: true },
          },
        },
      },
      body: { type: 'string' },
      bodyBase64: { type: 'boolean' },
    },
    execute: (args, exec) => runtime.networkControl(identity(exec), exec.signal, args as unknown as BrowserNetworkInput),
  })

  tool(definitions, {
    name: 'browser_profile',
    description: 'Capture bounded trace, CPU, coverage, heap snapshot, and heap sampling artifacts for the selected tab. Large results are stored in the plugin-managed artifact store. artifacts only lists metadata; artifact_read is size-limited and requires approval.',
    parameters: {
      action: { type: 'string', enum: profileActions, required: true },
      viewId: { type: 'string' },
      artifactId: { type: 'string' },
      maxReadBytes: { type: 'integer' },
    },
    execute: (args, exec) => runtime.profile(identity(exec), exec.signal, args as unknown as BrowserProfileInput),
  })

  tool(definitions, {
    name: 'browser_emulate',
    description: 'Apply explicit viewport, device, locale, timezone, network, CPU, offline, or permission emulation to the selected tab. reset clears plugin-applied emulation. All actions change browser state and require approval.',
    parameters: {
      action: { type: 'string', enum: emulateActions, required: true },
      viewId: { type: 'string' },
      width: { type: 'integer' },
      height: { type: 'integer' },
      deviceScaleFactor: { type: 'number' },
      mobile: { type: 'boolean' },
      device: { type: 'string' },
      locale: { type: 'string' },
      timezoneId: { type: 'string' },
      offline: { type: 'boolean' },
      latencyMs: { type: 'number' },
      downloadKbps: { type: 'number' },
      uploadKbps: { type: 'number' },
      rate: { type: 'number' },
      permissions: { type: 'array', items: { type: 'string' } },
      origin: { type: 'string' },
    },
    execute: (args, exec) => runtime.emulate(identity(exec), exec.signal, args as unknown as BrowserEmulateInput),
  })

  tool(definitions, {
    name: 'browser_live_view',
    description: 'Read or switch the right-side live browser display mode without approval. The human UI keeps these controls inside a collapsed floating panel; agents must call browser_live_view directly and must not search for or click that UI. standard fixes the real browser viewport at 1280x720 and preserves the page desktop layout with complete proportional rendering. adaptive follows the latest stable live-panel size and, when fixed-width layout containers still overflow horizontally, applies a bounded forced reflow to those containers without scaling the whole page. If forced reflow damages a complex page or hides a needed element, you may switch to standard without user approval, but you must tell the user after switching. Model switches affect only the current browser session and do not overwrite the user local preference.',
    parameters: {
      action: { type: 'string', enum: ['status', 'standard', 'adaptive'], required: true },
      viewId: { type: 'string' },
    },
    execute: (args, exec) => runtime.liveView(identity(exec), exec.signal, args as unknown as BrowserLiveViewInput),
  })

  tool(definitions, {
    name: 'browser_split_view',
    description: 'Read or control the current DSH Session browser internal two-page split view without approval. The human UI keeps these controls inside a collapsed floating panel; agents must call browser_split_view directly and must not search for or click that UI. open creates a second about:blank tab when only one tab exists. orientation switches between top-bottom and left-right. close keeps the focused tab. swap exchanges panes, assign places a viewId in one pane, focus changes the default tool target, and ratio clamps the first pane to 40%-60%. Tell the user after changing the layout.',
    parameters: {
      action: { type: 'string', enum: ['status', 'open', 'close', 'swap', 'assign', 'focus', 'ratio', 'orientation'], required: true },
      pane: { type: 'string', enum: ['top', 'bottom'] },
      orientation: { type: 'string', enum: ['top-bottom', 'left-right'] },
      viewId: { type: 'string' },
      ratio: { type: 'number' },
    },
    execute: async (args, exec) => {
      const result = await runtime.splitView(identity(exec), exec.signal, args as unknown as BrowserSplitViewInput)
      if (result.ok && isRecord(result.data) && result.data.changed === true && exec.agent !== undefined) {
        try {
          const orientationLabel = result.data.orientation === 'left-right' ? '左右' : '上下'
          exec.agent.inject(createBrowserNotice(
            `Agent 已调整右侧浏览器${orientationLabel}双页分屏：${result.data.enabled === true ? `已开启，第一窗格占比 ${Math.round(Number(result.data.ratio) * 100)}%` : '已关闭'}；当前焦点标签 viewId=${result.viewId ?? 'none'}。`,
            `Agent 调整浏览器${orientationLabel}分屏`,
          ))
        } catch {}
      }
      return result
    },
  })

  tool(definitions, {
    name: 'browser_evaluate',
    description: 'Evaluate explicit JavaScript in an isolated world, the page main world, or a paused call frame. Results are serialized, bounded, and redact sensitive property names. Every action requires approval because isolated code can still change shared DOM or start network requests.',
    parameters: {
      action: { type: 'string', enum: evaluateActions, required: true },
      viewId: { type: 'string' },
      expression: { type: 'string', required: true },
      callFrameId: { type: 'string' },
      awaitPromise: { type: 'boolean' },
    },
    execute: (args, exec) => runtime.evaluate(identity(exec), exec.signal, args as unknown as BrowserEvaluateInput),
  })

  tool(definitions, {
    name: 'browser_provider',
    description: 'Connect or disconnect this Session from an explicitly supplied Chrome/Edge remote-debugging endpoint. This tool does not launch or manage a browser, scan endpoints, or switch to another provider. Connect and disconnect require approval.',
    parameters: {
      action: { type: 'string', enum: providerActions, required: true },
      provider: { type: 'string', enum: providerChoices },
      endpoint: { type: 'string' },
    },
    execute: (args, exec) => runtime.provider(identity(exec), exec.signal, args as unknown as BrowserProviderInput),
  })

  tool(definitions, {
    name: 'browser_extensions',
    description: 'Compatibility read-only endpoint for the historical extension registry. External CDP mode does not inspect, install, enable, disable, uninstall, or host browser extensions; use the connected browser directly for extension management.',
    parameters: {
      action: { type: 'string', enum: extensionChoices, required: true },
    },
    execute: (args, exec) => runtime.extensions(identity(exec), exec.signal, args as unknown as BrowserExtensionInput),
  })

  tool(definitions, {
    name: 'browser_takeover',
    description: `Read or change exclusive browser control ownership. The human UI keeps takeover inside a collapsed floating panel; agents must call browser_takeover directly and must not search for or click that UI. While the user owns control, model write operations return USER_TAKEOVER_ACTIVE and read-only observation remains available. Request or preserve human control for every security verification challenge. ${verificationGuidance}`,
    parameters: {
      action: { type: 'string', enum: takeoverActions, required: true },
      viewId: { type: 'string' },
    },
    execute: (args, exec) => runtime.takeover(identity(exec), exec.signal, args as unknown as BrowserTakeoverInput),
  })

  return definitions
}

