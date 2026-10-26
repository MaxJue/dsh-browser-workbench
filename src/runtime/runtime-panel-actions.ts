import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from '../domain/errors.ts'
import { assertUrlAllowed } from '../domain/policy.ts'
import type { Identity, SessionState, ToolOutput, ViewState } from '../domain/types.ts'
import type { BrowserDebuggerInput, BrowserEmulateInput, BrowserExtensionInput, BrowserFrameCursor, BrowserInputTraceUpdate, BrowserLiveViewInput, BrowserNetworkInput, BrowserPanelActivity, BrowserPanelSnapshot, BrowserPanelTabInput, BrowserPanelView, BrowserProfileInput, BrowserProviderInput, BrowserRecorderInput, BrowserSplitViewInput, BrowserSplitViewPane, BrowserTakeoverInput, BrowserUserInput } from '../domain/protocol.ts'
import { classifyInputFailure, summarizeInputCharacters, type InputTraceRecord } from '../diagnostics/input-trace.ts'
import { STANDARD_VIEWPORT } from '../view/viewport.ts'
import { pendingSessionKey } from '../session/session-key.ts'
import { rawCdp } from '../cdp/cdp-raw.ts'
import { BrowserRuntimeToolActions } from './runtime-tool-actions.ts'

function asData(value: unknown): ToolOutput['data'] {
  return value as ToolOutput['data']
}

export class BrowserRuntimePanelActions extends BrowserRuntimeToolActions {
  async panelTakeover(sessionId: string, input: BrowserTakeoverInput): Promise<ToolOutput> {
    const session = this.sessionById(sessionId)
    if (session === undefined) return { ok: false, action: 'takeover', data: asData({ code: 'BROWSER_SESSION_NOT_READY', recoverable: true, message: 'browser session is not ready' }) }
    return this.queueSession(session, () => this.takeoverAction(session, input))
  }

  async panelInputTrace(sessionId: string, input: BrowserInputTraceUpdate): Promise<ToolOutput> {
    const session = this.sessionById(sessionId)
    if (session === undefined) return { ok: false, action: 'input_trace', data: asData({ code: 'BROWSER_SESSION_NOT_READY', recoverable: true, message: 'browser session is not ready' }) }
    return this.queueSession(session, async () => {
      const recorder = this.recorder.status(session.sessionId, session.key)
      if (recorder.mode === 'off' || recorder.status !== 'recording') return { ok: true, action: 'input_trace', viewId: input.viewId, data: asData({ recorded: false }) }
      const timestamp = Math.min(input.timestamp, Date.now())
      const trace = this.inputTraces.ensure({
        inputTraceId: input.inputTraceId,
        sessionKey: session.key,
        viewId: input.viewId,
        action: input.action,
        sensitivity: input.sensitivity,
        ...(input.characters === undefined ? {} : { characters: input.characters }),
        composing: input.composing,
        timestamp,
      })
      this.inputTraces.stage(session.key, input.inputTraceId, {
        stage: input.stage,
        timestamp,
        outcome: input.outcome,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      })
      const classifiedResult = classifyInputFailure(input)
      if (input.result !== undefined && input.result !== classifiedResult) fail('INVALID_ARGS', 'browser input trace result does not match the reported stage and outcome')
      if (classifiedResult !== undefined) this.inputTraces.finish(session.key, input.inputTraceId, { timestamp, result: classifiedResult, reason: input.reason })
      return { ok: true, action: 'input_trace', viewId: input.viewId, data: asData({ recorded: true, inputTraceId: trace.inputTraceId, stage: input.stage, result: classifiedResult ?? null }) }
    })
  }

  async panelInput(sessionId: string, input: BrowserUserInput): Promise<ToolOutput> {
    const session = this.sessionById(sessionId)
    if (session === undefined) return { ok: false, action: 'user_input', data: asData({ code: 'BROWSER_SESSION_NOT_READY', recoverable: true, message: 'browser session is not ready' }) }
    return this.queueSession(session, async () => {
      const startedAt = Date.now()
      const recorder = this.recorder.status(session.sessionId, session.key)
      const tracing = recorder.mode !== 'off' && recorder.status === 'recording'
      const inputTraceId = input.inputTraceId?.trim() || `host-legacy-${this.nextLegacyInputTrace++}`
      const clientRawObserved = typeof input.clientRawAt === 'number' && Number.isFinite(input.clientRawAt)
      const clientNormalizedObserved = typeof input.clientNormalizedAt === 'number' && Number.isFinite(input.clientNormalizedAt)
      // Client时间只用于标记输入管线阶段，不得越过Host实际接收时刻；Normalized也不能早于Raw，否则跨线程排队或异常调用会生成逆序证据。
      const clientRawAt = clientRawObserved ? Math.min(input.clientRawAt as number, startedAt) : startedAt
      const clientNormalizedAt = clientNormalizedObserved ? Math.min(Math.max(input.clientNormalizedAt as number, clientRawAt), startedAt) : startedAt
      const beforeView = session.views.get(input.viewId)
      const before = beforeView === undefined ? undefined : {
        viewId: beforeView.viewId,
        documentGeneration: beforeView.documentGeneration,
        navigationId: beforeView.navigationId,
      }
      const text = input.action === 'insert_text' || input.action === 'composition_commit'
        ? input.text
        : input.action === 'paste'
          ? `${input.text ?? ''}${input.html ?? ''}${input.uriList ?? ''}`
          : input.action === 'key_press' && [...input.key].length === 1
            ? input.key
            : ''
      let observation: Awaited<ReturnType<BrowserRuntimePanelActions['beginInputObservation']>> | undefined
      if (tracing && beforeView !== undefined) {
        observation = await this.beginInputObservation(beforeView, inputTraceId)
        const trace = this.inputTraces.ensure({
          inputTraceId,
          sessionKey: session.key,
          viewId: input.viewId,
          action: this.inputTraceAction(input),
          sensitivity: observation.sensitivity,
          ...(text === '' ? {} : { characters: summarizeInputCharacters(text) }),
          composing: input.composing ?? false,
          timestamp: clientRawAt,
        })
        this.inputTraces.stage(session.key, inputTraceId, {
          stage: 'client-raw',
          timestamp: clientRawAt,
          outcome: clientRawObserved ? 'observed' : 'unknown',
          ...(clientRawObserved ? {} : { reason: 'legacy-client-stage-unavailable' }),
        })
        this.inputTraces.stage(session.key, inputTraceId, {
          stage: 'client-normalized',
          timestamp: clientNormalizedAt,
          outcome: clientNormalizedObserved ? 'observed' : 'unknown',
          ...(clientNormalizedObserved ? {} : { reason: 'legacy-client-stage-unavailable' }),
        })
        this.inputTraces.stage(session.key, inputTraceId, { stage: 'rpc-received', timestamp: startedAt, outcome: 'delivered' })
        this.inputTraces.stage(session.key, inputTraceId, { stage: 'host-dispatched', timestamp: Date.now(), outcome: 'delivered' })
        void trace
      }
      let result: ToolOutput
      let inputResult: InputTraceRecord['result'] = 'unknown'
      let finalObservation: Awaited<ReturnType<BrowserRuntimePanelActions['finishInputObservation']>> | undefined
      try {
        result = await this.userInputAction(session, input)
        inputResult = result.ok ? 'delivered' : 'transport-lost'
      } catch (error) {
        inputResult = 'transport-lost'
        throw error
      } finally {
        if (tracing && beforeView !== undefined && observation !== undefined) {
          finalObservation = await this.finishInputObservation(beforeView, inputTraceId).catch(() => undefined)
          if (finalObservation !== undefined) {
            this.inputTraces.stage(session.key, inputTraceId, {
              stage: 'dom-observed',
              timestamp: Date.now(),
              outcome: finalObservation.observed ? 'observed' : 'unknown',
              ...(finalObservation.observed ? {} : { reason: 'no-dom-input-event-observed' }),
            })
            if (finalObservation.targetReplaced) inputResult = 'target-replaced'
            else if (finalObservation.composing) inputResult = 'composition-not-committed'
            else if (finalObservation.focusLost && (input.action === 'insert_text' || input.action === 'composition_commit' || input.action === 'paste' || input.action === 'key_press')) inputResult = 'focus-lost'
            else if (finalObservation.prevented) inputResult = 'prevented-by-page'
            else if (finalObservation.beforeInputObserved && finalObservation.finalLength === finalObservation.initialLength) inputResult = 'dropped-after-beforeinput'
            else if (!finalObservation.observed) inputResult = 'dropped-before-dom-event'
          }
          this.inputTraces.finish(session.key, inputTraceId, { timestamp: Date.now(), result: inputResult, targetReplaced: finalObservation?.targetReplaced })
        }
      }
      if ((input.action === 'composition_commit' || input.action === 'insert_text') && finalObservation !== undefined) {
        // 面板输入处于用户独占期，不能再调用模型Evaluate 读取页面。这里返回的观察摘要只包含
        // 事件类别、布尔状态与长度，用于验证真实Composition 及组合后普通输入链；绝不包含正文。
        result = {
          ...result,
          data: asData({
            action: input.action,
            observation: finalObservation,
          }),
        }
      }
      const after = session.views.get(result.viewId ?? input.viewId)
      if (after !== undefined) {
        const contextIdentity = after.cdp?.contextAdapter?.isEnabled() ? after.cdp.contextAdapter.mainContext() : {}
        const action = this.journal.recordAction({
          sessionId: session.sessionId,
          sessionKey: session.key,
          viewId: after.viewId,
          contextGeneration: session.contextGeneration,
          documentGeneration: after.documentGeneration,
          navigationId: after.navigationId,
          ...contextIdentity,
          callId: `panel-${startedAt}`,
          rootCallId: `panel-${startedAt}`,
          toolName: `browser_panel_${input.action}`,
          humanInitiated: true,
          startedAt,
          finishedAt: Date.now(),
          outcome: result.ok ? 'ok' : 'failed',
          ...(before === undefined ? {} : { beforeViewId: before.viewId, beforeDocumentGeneration: before.documentGeneration, beforeNavigationId: before.navigationId }),
          afterViewId: after.viewId,
          afterDocumentGeneration: after.documentGeneration,
          afterNavigationId: after.navigationId,
        })
        if (tracing) {
          const trace = this.inputTraces.get(session.key, inputTraceId)
          this.recorder.record(session.sessionId, session.key, {
            source: 'user',
            kind: `input-${input.action.replaceAll('_', '-')}`,
            viewId: after.viewId,
            documentGeneration: after.documentGeneration,
            navigationId: after.navigationId,
            ...contextIdentity,
            actionId: action.actionId,
            inputTraceId,
            outcome: inputResult,
            ...(trace === undefined ? {} : {
              input: {
                sensitivity: trace.sensitivity,
                ...(trace.characters === undefined ? {} : { characters: trace.characters }),
                composing: trace.composing,
                ...(trace.result === undefined ? {} : { result: trace.result }),
              },
            }),
            ...(finalObservation === undefined ? {} : {
              metrics: {
                initialLength: finalObservation.initialLength,
                finalLength: finalObservation.finalLength,
                targetReplaced: finalObservation.targetReplaced,
                focusLost: finalObservation.focusLost,
              },
            }),
          })
        }
      }
      return result
    })
  }

  async panelLiveView(sessionId: string, input: BrowserLiveViewInput): Promise<ToolOutput> {
    const session = this.sessionById(sessionId)
    if (session === undefined) return { ok: false, action: 'live_view', data: asData({ code: 'BROWSER_SESSION_NOT_READY', recoverable: true, message: 'browser session is not ready' }) }
    return this.queueSession(session, () => this.liveViewAction(session, input, 'user'))
  }

  async panelRecorder(sessionId: string, input: BrowserRecorderInput): Promise<ToolOutput> {
    const session = this.sessionById(sessionId)
    if (session === undefined) return { ok: false, action: 'recorder', data: asData({ code: 'BROWSER_SESSION_NOT_READY', recoverable: true, message: 'browser session is not ready' }) }
    return this.queueSession(session, () => this.recorderAction(session, input))
  }

  async panelSplitView(sessionId: string, input: BrowserSplitViewInput): Promise<ToolOutput> {
    const session = this.sessionById(sessionId)
    if (session === undefined) return { ok: false, action: 'split_view', data: asData({ code: 'BROWSER_SESSION_NOT_READY', recoverable: true, message: 'browser session is not ready' }) }
    return this.queueSession(session, () => this.splitViewAction(session, input))
  }

  async panelNetwork(sessionId: string, input: BrowserNetworkInput): Promise<ToolOutput> {
    const session = this.sessionById(sessionId)
    if (session === undefined) return { ok: false, action: 'network_control', data: asData({ code: 'BROWSER_SESSION_NOT_READY', recoverable: true, message: 'browser session is not ready' }) }
    return this.queueSession(session, () => this.networkAction(session, input, 'user'))
  }

  async panelProfile(sessionId: string, input: BrowserProfileInput): Promise<ToolOutput> {
    const session = this.sessionById(sessionId)
    if (session === undefined) return { ok: false, action: 'profile', data: asData({ code: 'BROWSER_SESSION_NOT_READY', recoverable: true, message: 'browser session is not ready' }) }
    return this.queueSession(session, () => this.profileAction(session, input, 'user'))
  }

  async panelProvider(sessionId: string, input: BrowserProviderInput, sessionCreatedAt?: number): Promise<ToolOutput> {
    let session = this.sessionById(sessionId)
    if (session === undefined) {
      session = await this.createSession({
        sessionId,
        sessionCreatedAt: sessionCreatedAt ?? Date.now(),
        callId: 'panel-provider',
        rootCallId: 'panel-provider',
      })
    }
    if (input.action === 'list' || input.action === 'capabilities') return this.queueSession(session, () => this.providerAction(session, input, 'user'))
    return this.queueSharedContext(() => this.queueSessions([session], () => this.providerAction(session, input, 'user')))
  }

  async panelExtensions(sessionId: string, input: BrowserExtensionInput): Promise<ToolOutput> {
    const session = this.sessionById(sessionId)
    if (session === undefined) return { ok: false, action: 'extensions', data: asData({ code: 'BROWSER_SESSION_NOT_READY', recoverable: true, message: 'browser session is not ready' }) }
    if (!this.extensionMutationRequiresSharedLock(session, input)) return this.queueSession(session, () => this.extensionAction(session, input))
    return this.queueSharedContext(() => this.queueSessions(this.sharedSessions(), () => this.extensionAction(session, input)))
  }

  async panelEmulate(sessionId: string, input: BrowserEmulateInput): Promise<ToolOutput> {
    const session = this.sessionById(sessionId)
    if (session === undefined) return { ok: false, action: 'emulate', data: asData({ code: 'BROWSER_SESSION_NOT_READY', recoverable: true, message: 'browser session is not ready' }) }
    return this.queueSession(session, () => this.emulateAction(session, input, 'user'))
  }

  async panelTabs(sessionId: string, input: BrowserPanelTabInput, sessionCreatedAt?: number): Promise<ToolOutput> {
    let session = this.sessionById(sessionId)
    let reuseInitialView = false
    if (session !== undefined && sessionCreatedAt !== undefined && session.key === pendingSessionKey(sessionId)) {
      session = await this.adoptPendingSession({ sessionId, sessionCreatedAt, callId: 'panel-adopt', rootCallId: 'panel-adopt' })
    }
    if (session === undefined && input.action === 'new') {
      if (sessionCreatedAt !== undefined) {
        // 正式 Session 已存在时直接创建最终隔离键；后续模型工具会命中同一个BrowserContext。
        session = await this.createSession({ sessionId, sessionCreatedAt, callId: 'panel-new', rootCallId: 'panel-new' })
      } else {
        // DSH 草稿尚未进入 Host Session Store 时使用sessionId@pending；正式Session 出现后由 adoptPendingSession 原子接管。
        session = await this.queueSharedContext(async () => {
          const pendingKey = pendingSessionKey(sessionId)
          const existingPending = this.state.sessions.get(pendingKey)
          if (existingPending !== undefined) return existingPending
          const splitPreference = await this.profiles.splitViewPreference(sessionId)
          const pending: SessionState = {
            key: pendingKey,
            sessionId,
            contextGeneration: 0,
            providerBinding: { kind: 'disconnected' },
            extensionRegistry: [],
            loadedExtensions: [],
            views: new Map(),
            activeViewId: '',
            splitView: this.splitViewState(splitPreference),
            nextViewId: 1,
            queue: Promise.resolve(),
            provider: 'disconnected',
            loadedExtensionIds: new Set(),
            liveView: { mode: 'adaptive', initialized: false, open: false, fixedWidth: STANDARD_VIEWPORT.width, fixedHeight: STANDARD_VIEWPORT.height, changedAt: Date.now() },
            control: { owner: 'model', pending: false, changedAt: Date.now() },
            diagnosticPanel: { readSequences: new Map() },
          }
          this.state.sessions.set(pending.key, pending)
          await this.bindContext(pending)
          return pending
        })
      }
      reuseInitialView = true
    }
    if (session === undefined) return { ok: false, action: 'panel_tabs', data: asData({ code: 'BROWSER_SESSION_NOT_READY', recoverable: true, message: 'browser session is not ready' }) }
    if (session.providerBinding.kind === 'disconnected') {
      if (input.action !== 'new') {
        return { ok: false, action: 'panel_tabs', data: asData({ code: 'BROWSER_NOT_CONNECTED', recoverable: true, message: '浏览器尚未启动：直接调用浏览器工具会自动启动本 Session 独立的浏览器，也可以点击 + 新标签页启动。' }) }
      }
      await this.ensureAutoProvider(session, { force: true })
      reuseInitialView = true
    }
    return this.queueSession(session, async () => {
      const current = input.viewId === undefined || input.viewId.trim() === ''
        ? session.views.get(session.activeViewId)
        : session.views.get(input.viewId)
      if (input.action !== 'new' && (current === undefined || current.page.isClosed())) {
        return { ok: false, action: 'panel_tabs', data: asData({ code: 'NO_ACTIVE_TAB', recoverable: true, message: 'browser session is not ready' }) }
      }
      const requireView = (): ViewState => {
        return current as ViewState
      }
      const activate = async (view: ViewState): Promise<boolean> => {
        const changed = session.activeViewId !== view.viewId
        session.activeViewId = view.viewId
        await view.page.bringToFront()
        await this.applyLiveViewport(session, view)
        if (changed) await this.syncScreencasts(session)
        return changed
      }

      if (input.action === 'new') {
        if (reuseInitialView) {
          // createSession 的bindContext 已创建首个about:blank；首次面板新建直接复用，避免一次点击产生两个标签。
          const view = session.views.get(session.activeViewId)
          if (view === undefined) fail('PROVIDER_UNAVAILABLE', 'browser session has no available tab')
          return { ok: true, action: 'panel_tabs', viewId: view.viewId, data: asData({ action: input.action, changed: true, title: '', url: view.page.url() }) }
        }
        const page = await this.createPage(session)
        const view = this.bindView(session, page)
        await activate(view)
        return { ok: true, action: 'panel_tabs', viewId: view.viewId, data: asData({ action: input.action, changed: true, title: '', url: page.url() }) }
      }

      if (input.action === 'select') {
        const view = requireView()
        const changed = await activate(view)
        return { ok: true, action: 'panel_tabs', viewId: view.viewId, data: asData({ action: input.action, changed, title: await view.page.title().catch(() => ''), url: view.page.url() }) }
      }

      if (input.action === 'close') {
        const view = requireView()
        const ordered = [...session.views.values()].filter(item => item.kind === 'page' && !item.page.isClosed())
        const closingIndex = ordered.findIndex(item => item.viewId === view.viewId)
        const wasActive = session.activeViewId === view.viewId
        const next = wasActive ? ordered[closingIndex + 1] ?? ordered[closingIndex - 1] : session.views.get(session.activeViewId)
        await view.page.close({ runBeforeUnload: false })
        if (next === undefined || next.page.isClosed()) {
          // 用户明确选择允许关闭最后一个标签；面板路径不得复用模型工具自动补空白页的兼容语义。
          session.activeViewId = ''
          return { ok: true, action: 'panel_tabs', data: asData({ action: input.action, changed: wasActive, empty: ![...session.views.values()].some(item => item.kind === 'page') }) }
        }
        if (wasActive) await activate(next)
        return { ok: true, action: 'panel_tabs', viewId: next.viewId, data: asData({ action: input.action, changed: wasActive, title: await next.page.title().catch(() => ''), url: next.page.url() }) }
      }

      const view = requireView()
      if (input.action === 'back') await view.page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 })
      else if (input.action === 'forward') await view.page.goForward({ waitUntil: 'domcontentloaded', timeout: 30000 })
      else if (input.action === 'reload') await view.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
      else if (input.action === 'navigate') {
        const raw = input.url?.trim()
        if (raw === undefined || raw === '') fail('INVALID_ARGS', 'address bar requires a non-empty URL')
        // 地址栏只承担网址导航；缺少协议时补https://，不把普通文本隐式发送给第三方搜索引擎。
        const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`
        const url = assertUrlAllowed(this.config, candidate)
        await view.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 })
      } else fail('INVALID_ARGS', `unknown browser panel tab action ${JSON.stringify(input.action)}`)
      if (view.page.url() !== 'about:blank') assertUrlAllowed(this.config, view.page.url())
      await activate(view)
      return { ok: true, action: 'panel_tabs', viewId: view.viewId, data: asData({ action: input.action, changed: true, title: await view.page.title().catch(() => ''), url: view.page.url() }) }
    })
  }

  /**
   * 面板关闭时的廉价探测：回答「这个 Session 现在有没有可看的页面」。
   * 与 panelSnapshot 不同，这里不分配 View、不推进 activeViewId、也不启动 screencast，
   * 因此可以安全地被客户端按秒轮询。
   */
  panelActivity(sessionId: string): BrowserPanelActivity {
    const session = this.sessionById(sessionId)
    if (session === undefined) return { available: false, tabCount: 0 }
    const pages = [...session.views.values()].filter(item => item.kind === 'page' && !item.page.isClosed())
    const current = pages.find(item => item.viewId === session.activeViewId) ?? pages[0]
    return {
      available: session.providerBinding.kind !== 'disconnected',
      tabCount: pages.length,
      ...(current === undefined ? {} : {
        activeViewId: current.viewId,
        activeUrl: current.page.url(),
        navigationGeneration: current.navigationGeneration,
        snapshotGeneration: current.snapshotGeneration,
      }),
    }
  }

  async panelSnapshot(sessionId: string, view: BrowserPanelView, streamGeneration?: number, sequence?: number, splitCursors?: Partial<Record<BrowserSplitViewPane, BrowserFrameCursor>>, popupCursor?: BrowserFrameCursor, diagnosticReadSequence?: number): Promise<BrowserPanelSnapshot> {
    const session = this.sessionById(sessionId)
    if (session === undefined) {
      return { available: false, sessionId, tabs: [], console: [], network: [], message: '浏览器尚未启动：直接调用浏览器工具会自动启动本 Session 独立的浏览器，也可以在这里手动启动或连接现有 Chrome。' }
    }
    if (session.providerBinding.kind === 'disconnected') {
      return {
        available: false,
        sessionId,
        tabs: [],
        console: [],
        network: [],
        capabilities: { provider: 'disconnected', debugger: false, networkInterception: false, tracing: false, cpuProfile: false, coverage: false, heap: false, emulation: false, evaluate: false, screencast: false, takeover: false },
        message: '浏览器尚未启动：直接调用浏览器工具会自动启动本 Session 独立的浏览器，也可以在这里手动启动或连接现有 Chrome。',
      }
    }
    const current = session.views.get(session.activeViewId) ?? [...session.views.values()].find(item => item.kind === 'page' && !item.page.isClosed())
    if (current === undefined) {
      const extensionState = view === 'extensions' ? await this.extensionState(session) : undefined
      return { available: true, sessionId, tabs: [], console: [], network: [], ...(extensionState === undefined ? {} : extensionState), capabilities: { provider: session.provider, debugger: true, networkInterception: true, tracing: true, cpuProfile: true, coverage: true, heap: true, emulation: true, evaluate: true, screencast: true, takeover: true }, control: session.control, message: 'no browser tab is currently available'}
    }
    session.activeViewId = current.viewId
    if (view === 'live') session.liveView.open = true
    await this.syncScreencasts(session)
    if (view === 'diagnostic' && diagnosticReadSequence !== undefined && Number.isInteger(diagnosticReadSequence) && diagnosticReadSequence >= 0) {
      // 未读状态属于用户是否查看过诊断工作台，不属于Journal本身。只有诊断视图显式回传已显示序列时才推进当前View游标；Live、Console和Network的后台轮询都不能自动吞掉未读异常，推进游标也绝不删除底层证据。
      const previous = session.diagnosticPanel.readSequences.get(current.viewId) ?? 0
      session.diagnosticPanel.readSequences.set(current.viewId, Math.max(previous, diagnosticReadSequence))
    }
    if (view === 'live' && !session.splitView.enabled) {
      const target = this.liveViewport(session)
      if (
        current.viewport.width !== target.width
        || current.viewport.height !== target.height
        || (session.liveView.mode === 'adaptive' && current.viewport.fitDocumentGeneration !== current.documentGeneration)
      ) {
        await this.queueSession(session, () => this.applyLiveViewport(session, current))
      }
      await this.ensureScreencast(session, current, 'live-view')
    }
    const splitPanes: NonNullable<NonNullable<BrowserPanelSnapshot['splitView']>['panes']> = []
    if (view === 'live' && session.splitView.enabled) {
      for (const pane of ['top', 'bottom'] as const) {
        const target = this.splitPaneView(session, pane)
        if (target === undefined) continue
        await this.queueSession(session, async () => {
          await this.applyLiveViewport(session, target)
          await this.ensureScreencast(session, target, 'live-view')
        })
        const paneFrame = target.cdp?.latestFrame
        const cursor = splitCursors?.[pane]
        splitPanes.push({
          pane,
          viewId: target.viewId,
          focused: session.splitView.focusedPane === pane,
          liveView: this.liveViewState(session, target),
          ...(paneFrame === undefined || (cursor?.streamGeneration === paneFrame.streamGeneration && cursor.sequence === paneFrame.sequence) ? {} : { frame: paneFrame }),
        })
      }
    }
    const tabs: BrowserPanelSnapshot['tabs'] = []
    for (const [index, item] of [...session.views.values()].filter(item => item.kind === 'page').entries()) {
      tabs.push({
        index,
        viewId: item.viewId,
        url: item.page.url(),
        title: await item.page.title().catch(() => ''),
        active: item.viewId === current.viewId,
        status: item.page.isClosed() ? 'closed' : 'loaded',
      })
    }
    const frame = current.cdp?.latestFrame
    // 扩展 Popup 属于整个右侧浏览器面板，而不是扩展管理子视图；所有视图都返回其状态和增量帧，切回实况时继续显示和操作。
    const popup = session.extensionPopup
    if (popup !== undefined) await this.ensureScreencast(session, popup.view, 'live-view')
    const popupFrame = popup?.view.cdp?.latestFrame
    return {
      available: true,
      sessionId,
      activeViewId: current.viewId,
      tabs,
      console: current.console.slice(-100),
      network: current.network.slice(-150),
      debugger: this.debuggerState(current),
      pausedRequests: this.pausedRequests(current),
      artifacts: this.artifacts.list(session.key),
      ...(view === 'extensions' ? await this.extensionState(session) : {}),
      ...(popup === undefined ? {} : {
        extensionPopup: {
          extensionId: popup.extensionId,
          name: popup.name,
          viewId: popup.view.viewId,
          width: popup.view.viewport.width,
          height: popup.view.viewport.height,
          ...(popupFrame === undefined || (popupCursor?.streamGeneration === popupFrame.streamGeneration && popupCursor.sequence === popupFrame.sequence) ? {} : { frame: popupFrame }),
        },
      }),
      capabilities: {
        provider: session.provider,
        debugger: true,
        networkInterception: true,
        tracing: true,
        cpuProfile: true,
        coverage: true,
        heap: true,
        emulation: true,
        evaluate: true,
        screencast: true,
        takeover: true,
      },
      control: session.control,
      diagnostic: this.panelDiagnosticSnapshot(session, current),
      splitView: {
        ...this.splitSnapshot(session),
        ...(splitPanes.length === 0 ? {} : { panes: splitPanes }),
      },
      liveView: {
        mode: session.liveView.mode,
        initialized: session.liveView.initialized,
        width: current.viewport.width,
        height: current.viewport.height,
        viewportGeneration: current.viewport.generation,
        reflowed: current.viewport.reflowedElements > 0,
        contentWidth: current.viewport.contentWidth,
        fittedWidth: current.viewport.fittedWidth,
        reflowedElements: current.viewport.reflowedElements,
        changedAt: session.liveView.changedAt,
      },
      ...(!session.splitView.enabled && frame !== undefined && (frame.streamGeneration !== streamGeneration || frame.sequence !== sequence) ? { frame } : {}),
    }
  }

  async panelDebugger(sessionId: string, input: BrowserDebuggerInput): Promise<ToolOutput> {
    const session = this.sessionById(sessionId)
    if (session === undefined) {
      return { ok: false, action: 'debugger', data: asData({ code: 'BROWSER_NOT_CONNECTED', recoverable: true, message: 'browser session is not ready' }) }
    }
    return this.queueSession(session, () => this.debuggerAction(session, input, 'user'))
  }

  async panelClose(sessionId: string, view: BrowserPanelView): Promise<void> {
    if (view !== 'live') return
    const session = this.sessionById(sessionId)
    if (session === undefined) return
    await this.queueSession(session, async () => {
      session.liveView.open = false
      const current = session.views.get(session.activeViewId)
      if (current !== undefined) this.finishPanelTakeover(session, current)
      session.control.owner = 'model'
      session.control.pending = false
      session.control.changedAt = Date.now()
      await Promise.all([...session.views.values()].map(async item => {
        await this.clearAdaptiveFit(item)
        await this.releaseScreencast(item, 'live-view')
      }))
    })
  }

  async suspendSessionController(sessionId: string): Promise<void> {
    const session = this.sessionById(sessionId)
    if (session === undefined) return
    await this.queueSession(session, async () => {
      // 控制器退出必须先收敛会阻塞页面或持续采集数据的能力，再撤销工具面。
      // 这里保留 Page 与BrowserContext，只使本插件的调试、采集和引用身份全部失效。
      for (const view of session.views.values()) {
        const cdp = view.cdp
        if (cdp === undefined) {
          await this.releaseViewRefs(view)
          view.lastSnapshot = undefined
          continue
        }
        const client = rawCdp(cdp.session)

        await this.releasePausedRequests(view)
        if (cdp.networkEnabled) {
          await client.send('Fetch.disable')
          cdp.networkEnabled = false
        }
        if (cdp.paused) await client.send('Debugger.resume')

        if (cdp.profile.traceActive) {
          await this.profileAction(session, { action: 'trace_stop', viewId: view.viewId }, 'user')
        }
        if (cdp.profile.cpuActive) {
          await this.profileAction(session, { action: 'cpu_stop', viewId: view.viewId }, 'user')
        }
        if (cdp.profile.jsCoverageActive || cdp.profile.cssCoverageActive) {
          await this.profileAction(session, { action: 'coverage_stop', viewId: view.viewId }, 'user')
        }
        if (cdp.profile.heapSamplingActive) {
          await this.profileAction(session, { action: 'heap_sampling_stop', viewId: view.viewId }, 'user')
        }

        await this.clearAdaptiveFit(view)
        await this.forceStopScreencast(view)
        cdp.contextAdapter?.dispose()
        await cdp.session.detach()
        view.cdp = undefined
        view.viewport.generation += 1
        await this.releaseViewRefs(view)
        view.lastSnapshot = undefined
      }

      if (session.playwrightTraceViewId !== undefined) {
        const traceViewId = session.playwrightTraceViewId
        await this.profileAction(session, { action: 'playwright_trace_stop', viewId: traceViewId }, 'user')
      }

      const recorder = this.recorder.status(session.sessionId, session.key)
      if (recorder.mode !== 'off' && recorder.status === 'recording') this.recorder.pause(session.key)
      const current = session.views.get(session.activeViewId)
      if (current !== undefined) this.finishPanelTakeover(session, current)
      session.control.owner = 'model'
      session.control.pending = false
      session.control.changedAt = Date.now()
      session.liveView.open = false

      // Controller generation 改变后，旧Checkpoint、Build、Application 与Context Identity
      // 都不能继续参与Compare；Artifact 仍按 Session 规则保留，但不再代表当前控制器状态。
      this.debugSessions.invalidate(session.key)
      this.contextIdentities.invalidateSession(session.key, session.contextGeneration + 1)
      this.builds.clearSession(session.key)
      this.applications.clearSession(session.key)
      session.contextGeneration += 1
      session.diagnosticPanel.readSequences.clear()
      session.diagnosticPanel.latestInspect = undefined
      session.diagnosticPanel.latestComparison = undefined
      session.diagnosticPanel.latestIncident = undefined
      session.diagnosticPanel.takeover = undefined
      session.diagnosticPanel.latestTakeoverSummary = undefined
    })
  }

  // 返回是否真的释放了该 Session 的运行时资源：false 表示 Runtime 里已经没有可释放对象，
  // 调用方（Controller）据此向用户报告“没有正在使用的资源”，不再伪装成释放成功。
  async disposeSession(identity: Pick<Identity, 'sessionId' | 'sessionCreatedAt'>): Promise<boolean> {
    const key = `${identity.sessionId}@${identity.sessionCreatedAt}`
    let session: SessionState | undefined
    await this.queueSharedContext(async () => {
      session = this.state.sessions.get(key)
      if (session === undefined) return
      this.state.sessions.delete(key)
      await this.queueSessions([session], () => this.cleanupProvider(session as SessionState))
    })
    if (session === undefined) return false
    await this.artifacts.removeSession(key)
    this.debugSessions.stop(key)
    this.journal.clearSession(key)
    this.contextIdentities.invalidateSession(key)
    this.recorder.disposeSession(key)
    this.inputTraces.clearSession(key)
    this.builds.clearSession(key)
    this.applications.clearSession(key)
    await rm(join(this.config.artifactRoot, key.replace(/[^\w.-]/g, '_')), { recursive: true, force: true })
    return true
  }

  async dispose(): Promise<void> {
    if (this.state.disposed) return
    this.state.disposed = true
    await this.chromiumManager.dispose()
    await this.state.sharedPersistent.queue
    const sessions = [...this.state.sessions.values()]
    this.state.sessions.clear()
    await Promise.allSettled(sessions.map(session => this.cleanupProvider(session)))
    await Promise.allSettled(sessions.map(session => this.artifacts.removeSession(session.key)))
    this.debugSessions.clear()
    this.journal.clear()
    this.contextIdentities.clear()
    this.recorder.clear()
    this.inputTraces.clear()
    this.builds.clear()
    this.applications.clear()
    const sharedContext = await this.state.sharedPersistent.launch?.catch(() => undefined) ?? this.state.sharedPersistent.context
    this.state.sharedPersistent.context = undefined
    this.state.sharedPersistent.pageOwners.clear()
    if (sharedContext !== undefined) await sharedContext.close().catch(() => {})
    const browser = await this.state.launch?.catch(() => undefined) ?? this.state.browser
    if (browser !== undefined) await browser.close().catch(() => {})
    await this.artifacts.dispose()
  }
}

