import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Page } from 'playwright-core'
import { abortReason, fail, requireActive } from '../domain/errors.ts'
import { assertCdpEndpoint } from '../domain/policy.ts'
import type {
  BrowserEvaluateInput,
  BrowserExtensionInput,
  BrowserExtensionSummary,
  BrowserNetworkInput,
  BrowserProfileInput,
  BrowserProviderInput,
} from '../domain/protocol.ts'
import type { Identity, SessionState, ToolOutput, ViewState } from '../domain/types.ts'
import { number as parseNumber, rawCdp, record, string } from '../cdp/cdp-raw.ts'
import { chromeWebStoreExtensionId, downloadChromeWebStoreExtension, extensionIdForKey, unpackedExtensionId } from '../extensions/crx.ts'
import { openExtensionPopup } from '../extensions/extension-popup.ts'
import { projectExtensionState } from '../extensions/extension-state.ts'
import { networkControlAction } from '../page/network-control.ts'
import { stopOnAbort } from '../page/page-operation.ts'
import { ChromiumManager } from '../provider/chromium-manager.ts'
import { connectExternalCdp } from '../provider/external-cdp.ts'
import type { BrowserExtensionRecord } from '../provider/persistent-profile.ts'
import { profileRecordAction } from '../provider/profile-actions.ts'
import { providerState } from '../provider/provider.ts'
import { sessionKey } from '../session/session-key.ts'
import { restorableTabs, type RestorableTabs } from '../session/session-tabs.ts'
import { STANDARD_VIEWPORT } from '../view/viewport.ts'
import { BrowserRuntimeDiagnosticServices } from './runtime-diagnostic-services.ts'
import { safeRemoteResult } from './runtime-projections.ts'

function asData(value: unknown): ToolOutput['data'] {
  return value as ToolOutput['data']
}

export class BrowserRuntimeServices extends BrowserRuntimeDiagnosticServices {
  protected async networkAction(session: SessionState, input: BrowserNetworkInput, actor: 'model' | 'user' = 'model'): Promise<ToolOutput> {
    const view = this.view(session, input.viewId)
    if (actor === 'model' && input.action !== 'list_paused' && input.action !== 'body') {
      const blocked = this.modelWriteBlocked(session, view, 'network_control')
      if (blocked !== undefined) return blocked
    }
    const state = await this.cdp(session, view)
    return networkControlAction(input, {
      state,
      viewId: view.viewId,
      maxOutputChars: this.config.maxOutputChars,
      saveArtifact: (kind, name, data) => this.artifacts.save(session.key, kind, name, data),
      replay: async (url, method, postData) => {
        const response = await this.sessionContext(session).request.fetch(url, {
          method,
          data: postData,
          failOnStatusCode: false,
        })
        const body = await response.body()
        return { status: response.status(), body }
      },
    })
  }

  protected async profileAction(session: SessionState, input: BrowserProfileInput, actor: 'model' | 'user' = 'model'): Promise<ToolOutput> {
    const view = this.view(session, input.viewId)
    if (actor === 'model') {
      const blocked = this.modelWriteBlocked(session, view, 'performance')
      if (blocked !== undefined) return blocked
    }
    const state = await this.cdp(session, view)
    if (input.action === 'artifacts') {
      const artifacts = state.profile.artifacts
      return { ok: true, action: 'artifacts', viewId: view.viewId, data: asData({ artifacts }) }
    }
    if (input.action === 'artifact_read') {
      if (input.artifactId === undefined) fail('INVALID_ARGS', 'artifact_read requires artifactId')
      const artifact = state.profile.artifacts.find(item => item.artifactId === input.artifactId)
      if (artifact === undefined) fail('INVALID_ARGS', `artifact ${input.artifactId} not found`)
      const maxBytes = input.maxReadBytes ?? this.config.maxOutputChars
      const content = await this.artifacts.read(session.key, artifact.artifactId, maxBytes)
      return { ok: true, action: 'artifact_read', viewId: view.viewId, data: asData({ artifact, ...content }) }
    }
    return profileRecordAction(input, {
      session,
      view,
      state,
      context: this.sessionContext(session),
      artifactRoot: this.config.artifactRoot,
      maxArtifactBytes: this.config.maxArtifactBytes,
      artifacts: this.artifacts,
    })
  }

  protected async extensionState(session: SessionState): Promise<{ extensions: BrowserExtensionSummary[]; chromium: Awaited<ReturnType<ChromiumManager['status']>> }> {
    const status = await this.chromiumManager.status()
    return {
      extensions: projectExtensionState(session.extensionRegistry, session.loadedExtensions),
      chromium: status,
    }
  }

  protected async restoreTabs(session: SessionState, tabs: RestorableTabs): Promise<void> {
    const urls = tabs.urls.length > 0 ? tabs.urls : ['about:blank']
    const views: ViewState[] = []
    for (const url of urls) {
      const page = await this.createPage(session)
      const view = this.bindView(session, page)
      views.push(view)
      if (url !== 'about:blank') {
        await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {})
      }
    }
    const target = views[tabs.activeIndex] ?? views[0]
    if (target !== undefined) {
      session.activeViewId = target.viewId
    }
    if (tabs.split !== undefined) {
      const topView = views[tabs.split.topIndex]
      const bottomView = views[tabs.split.bottomIndex]
      if (topView !== undefined && bottomView !== undefined && topView.viewId !== bottomView.viewId) {
        session.splitView.enabled = true
        session.splitView.topViewId = topView.viewId
        session.splitView.bottomViewId = bottomView.viewId
        session.splitView.focusedPane = tabs.split.focusedPane
        session.splitView.orientation = tabs.split.orientation
        session.splitView.ratio = tabs.split.ratio
        session.splitView.changedAt = Date.now()
        await this.applyVisibleLiveViewports(session)
        return
      }
    }
    session.splitView.enabled = false
    session.splitView.topViewId = undefined
    session.splitView.bottomViewId = undefined
    session.splitView.changedAt = Date.now()
    await this.applyVisibleLiveViewports(session)
  }

  protected async restartPersistentSession(
    session: SessionState,
    tabs = restorableTabs(session, this.config),
    launchExtensions?: readonly SessionState['extensionRegistry'][number][],
  ): Promise<void> {
    if (session.providerBinding.kind === 'external-cdp') {
      // The user's own Chrome cannot be relaunched by the plugin. Tearing the live CDP binding down
      // would leave the session unusable, so an "apply" keeps the registry pending instead.
      session.extensionRegistry = [...await this.profiles.listExtensions(session.sessionId)]
      return
    }
    const registry = launchExtensions ?? session.extensionRegistry
    for (const view of session.views.values()) {
      await this.releaseViewRefs(view)
    }
    session.views.clear()
    await this.cleanupProvider(session)
    if (session.providerBinding.kind === 'isolated-persistent') {
      const { context, extensionRegistry, loadedExtensions, loadedExtensionIds } = await this.persistentContext(
        session.sessionId,
        session.persistentProfile ?? 'default',
        registry,
      )
      session.providerBinding = { kind: 'isolated-persistent', context, profileName: session.persistentProfile ?? 'default' }
      session.extensionRegistry = [...extensionRegistry]
      session.loadedExtensions = [...loadedExtensions]
      session.loadedExtensionIds = new Set(loadedExtensionIds)
    }
    await this.bindContext(session)
    await this.restoreTabs(session, tabs)
  }

  protected async restartSharedPersistentContext(
    session: SessionState,
    mutateRegistry: (registry: SessionState['extensionRegistry']) => Promise<SessionState['extensionRegistry']> | SessionState['extensionRegistry'],
  ): Promise<void> {
    const affected = [...this.state.sessions.values()].filter(target => target.providerBinding.kind === 'shared-persistent')
    const key = session.key
    const targetSession = affected.find(target => target.key === key) ?? session
    const otherSessions = affected.filter(target => target.key !== key)
    const targetTabs = restorableTabs(targetSession, this.config)
    const otherTabs = new Map(otherSessions.map(target => [target.key, restorableTabs(target, this.config)]))
    const current = await this.profiles.listSharedExtensions()
    const updated = await mutateRegistry(current)
    await this.profiles.saveSharedExtensions(updated)
    this.state.sharedPersistent.extensionRegistry = [...updated]
    for (const target of affected) {
      target.extensionRegistry = [...updated]
      target.loadedExtensions = []
      target.loadedExtensionIds.clear()
    }
    if (this.state.sharedPersistent.context !== undefined) {
      await this.state.sharedPersistent.context.close().catch(() => {})
      this.state.sharedPersistent.context = undefined
    }
    await this.launchSharedPersistentContext(updated)
    this.syncSharedExtensions()
    await this.restartPersistentSession(targetSession, targetTabs, updated)
    for (const other of otherSessions) {
      const tabs = otherTabs.get(other.key) ?? { urls: ['about:blank'], activeIndex: 0 }
      other.providerBinding = { kind: 'shared-persistent' }
      other.extensionRegistry = [...updated]
      await this.bindContext(other)
      await this.restoreTabs(other, tabs)
    }
  }

  protected extensionMutationRequiresSharedLock(session: SessionState, input: BrowserExtensionInput): boolean {
    if (input.action !== 'install' && input.action !== 'uninstall' && input.action !== 'enable' && input.action !== 'disable') return false
    return session.providerBinding.kind === 'shared-persistent'
  }

  protected async extensionAction(session: SessionState, input: BrowserExtensionInput): Promise<ToolOutput> {
    if (this.extensionMutationRequiresSharedLock(session, input)) {
      return this.queueSharedContext(async () => this.extensionAction(session, input))
    }
    const state = await this.extensionState(session)
    if (input.action === 'list') {
      return { ok: true, action: 'extension_list', viewId: session.activeViewId, data: asData(state) }
    }
    if (input.action === 'install') {
      const location = input.extension?.trim() || input.extensionId?.trim()
      if (location === undefined || location === '') fail('INVALID_ARGS', 'browser_extension install requires extension or extensionId')
      let unpackedDir: string
      let extensionId: string
      let name: string
      let version: string
      let actionPopup: string | undefined
      const sourceUrl = location
      if (location.endsWith('.crx') || location.includes('/') || location.includes('\\')) {
        const destination = join(this.profiles.extensionDirectory(session.sessionId, `ext-${Date.now()}`))
        await mkdir(destination, { recursive: true })
        if (location.endsWith('.crx')) {
          const manifest = await downloadChromeWebStoreExtension(location, destination)
          unpackedDir = destination
          extensionId = manifest.extensionId
          name = manifest.name
          version = manifest.version
          actionPopup = manifest.actionPopup
        } else {
          unpackedDir = resolve(location)
          const manifestPath = join(unpackedDir, 'manifest.json')
          let manifest: Record<string, unknown>
          try {
            manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
          } catch (error) {
            fail('INVALID_ARGS', `extension directory must contain a readable manifest.json: ${String((error as Error).message ?? error)}`)
          }
          if (manifest.manifest_version !== 3) fail('INVALID_ARGS', 'only Manifest V3 extensions are supported')
          if (typeof manifest.name !== 'string' || manifest.name.trim() === '') fail('INVALID_ARGS', 'extension manifest name is missing')
          if (typeof manifest.version !== 'string' || manifest.version.trim() === '') fail('INVALID_ARGS', 'extension manifest version is missing')
          name = manifest.name.trim()
          version = manifest.version.trim()
          // An unpacked directory may carry a manifest key; otherwise Chrome derives the ID from the path.
          const manifestKey = typeof manifest.key === 'string' ? Buffer.from(manifest.key, 'base64') : undefined
          extensionId = manifestKey !== undefined && manifestKey.byteLength > 0 ? extensionIdForKey(manifestKey) : unpackedExtensionId(unpackedDir)
          const action = typeof manifest.action === 'object' && manifest.action !== null ? manifest.action as Record<string, unknown> : undefined
          const browserAction = typeof manifest.browser_action === 'object' && manifest.browser_action !== null ? manifest.browser_action as Record<string, unknown> : undefined
          const popup = typeof action?.default_popup === 'string' ? action.default_popup : typeof browserAction?.default_popup === 'string' ? browserAction.default_popup : ''
          actionPopup = popup.trim() === '' ? undefined : popup.trim()
        }
      } else {
        extensionId = chromeWebStoreExtensionId(location)
        const destination = this.profiles.extensionDirectory(session.sessionId, extensionId)
        const manifest = await downloadChromeWebStoreExtension(location, destination)
        unpackedDir = destination
        name = manifest.name
        version = manifest.version
        actionPopup = manifest.actionPopup
      }
      const recordItem: BrowserExtensionRecord = {
        extensionId,
        name,
        version,
        path: unpackedDir,
        enabled: true,
        installedAt: Date.now(),
        sourceUrl,
        ...(actionPopup === undefined ? {} : { actionPopup }),
      }
      if (session.providerBinding.kind === 'shared-persistent') {
        await this.restartSharedPersistentContext(session, registry => [...registry.filter(ext => ext.extensionId !== extensionId), recordItem])
      } else {
        const existing = await this.profiles.listExtensions(session.sessionId)
        const updated = [...existing.filter(ext => ext.extensionId !== extensionId), recordItem]
        await this.profiles.saveExtensions(session.sessionId, updated)
        session.extensionRegistry = updated
      }
      if (input.applyMode === 'now') {
        await this.restartPersistentSession(session)
      }
      const nextState = await this.extensionState(session)
      return { ok: true, action: 'extension_install', viewId: session.activeViewId, data: asData({ extension: recordItem, ...nextState }) }
    }
    if (input.action === 'enable' || input.action === 'disable') {
      const extId = input.extensionId?.trim() || input.extension?.trim()
      if (extId === undefined || extId === '') fail('INVALID_ARGS', `browser_extension ${input.action} requires extensionId`)
      const enabled = input.action === 'enable'
      if (session.providerBinding.kind === 'shared-persistent') {
        await this.restartSharedPersistentContext(session, registry => registry.map(ext => ext.extensionId === extId ? { ...ext, enabled } : ext))
      } else {
        const existing = await this.profiles.listExtensions(session.sessionId)
        const updated = existing.map(ext => ext.extensionId === extId ? { ...ext, enabled } : ext)
        await this.profiles.saveExtensions(session.sessionId, updated)
        session.extensionRegistry = updated
      }
      if (input.applyMode === 'now') {
        await this.restartPersistentSession(session)
      }
      const nextState = await this.extensionState(session)
      return { ok: true, action: `extension_${input.action}`, viewId: session.activeViewId, data: asData(nextState) }
    }
    if (input.action === 'uninstall') {
      const extId = input.extensionId?.trim() || input.extension?.trim()
      if (extId === undefined || extId === '') fail('INVALID_ARGS', 'browser_extension uninstall requires extensionId')
      const target = session.extensionRegistry.find(ext => ext.extensionId === extId)
      if (session.providerBinding.kind === 'shared-persistent') {
        await this.restartSharedPersistentContext(session, registry => registry.filter(ext => ext.extensionId !== extId))
      } else {
        const existing = await this.profiles.listExtensions(session.sessionId)
        const updated = existing.filter(ext => ext.extensionId !== extId)
        await this.profiles.saveExtensions(session.sessionId, updated)
        session.extensionRegistry = updated
      }
      if (target !== undefined) {
        await this.profiles.removeExtensionDirectory(session.sessionId, target.extensionId).catch(() => {})
      }
      if (input.applyMode === 'now') {
        await this.restartPersistentSession(session)
      }
      const nextState = await this.extensionState(session)
      return { ok: true, action: 'extension_uninstall', viewId: session.activeViewId, data: asData(nextState) }
    }
    if (input.action === 'apply') {
      await this.restartPersistentSession(session)
      const nextState = await this.extensionState(session)
      return { ok: true, action: 'extension_apply', viewId: session.activeViewId, data: asData(nextState) }
    }
    if (input.action === 'open_popup') {
      const extId = input.extensionId?.trim() || input.extension?.trim()
      if (extId === undefined || extId === '') fail('INVALID_ARGS', 'browser_extension open_popup requires extensionId')
      const target = session.extensionRegistry.find(ext => ext.extensionId === extId)
      if (target === undefined) fail('INVALID_ARGS', `extension ${extId} not found`)
      return openExtensionPopup({
        session,
        extension: target,
        createPage: s => this.createPage(s, 'extension-popup'),
        bindView: (s, p) => this.bindView(s, p, 'extension-popup'),
        syncScreencasts: s => this.syncScreencasts(s),
      })
    }
    if (input.action === 'close_popup') {
      if (session.extensionPopup !== undefined) {
        await session.extensionPopup.view.page.close({ runBeforeUnload: false }).catch(() => {})
        session.extensionPopup = undefined
        await this.syncScreencasts(session)
      }
      return { ok: true, action: 'extension_close_popup', viewId: session.activeViewId, data: asData({ closed: true }) }
    }
    fail('INVALID_ARGS', `unknown browser extension action ${JSON.stringify(input.action)}`)
  }

  // private async providerAction
  protected async providerAction(session: SessionState, input: BrowserProviderInput, actor: 'model' | 'user' = 'model'): Promise<ToolOutput> {
    if (actor === 'model' && input.action !== 'list' && input.action !== 'capabilities') {
      const view = session.views.get(session.activeViewId)
      if (view !== undefined) {
        const blocked = this.modelWriteBlocked(session, view, 'provider')
        if (blocked !== undefined) return blocked
      }
    }
    if (input.action === 'list' || input.action === 'capabilities') {
      return { ok: true, action: 'provider', viewId: session.activeViewId, data: asData(providerState(session)) }
    }
    if (input.action === 'connect') {
      if (input.provider === 'managed') {
        if (session.provider !== 'disconnected') fail('INVALID_ARGS', 'browser is already connected; disconnect it before switching providers')
        await this.ensureAutoProvider(session, { force: true })
        return { ok: true, action: 'provider_connect', viewId: session.activeViewId, data: asData(providerState(session)) }
      }
      if (input.provider !== undefined && input.provider !== 'external-cdp') {
        fail('UNSUPPORTED_PROVIDER', '连接现有浏览器只支持 external-cdp；本会话浏览器由 managed 自动启动')
      }
      const rawEndpoint = input.endpoint?.trim()
      if (rawEndpoint === undefined || rawEndpoint === '') fail('INVALID_ARGS', 'provider connect requires endpoint')
      const endpoint = assertCdpEndpoint(rawEndpoint).href
      const tabs = restorableTabs(session, this.config)
      for (const view of session.views.values()) {
        await this.releaseViewRefs(view)
      }
      session.views.clear()
      await this.cleanupProvider(session)
      const connection = await connectExternalCdp(endpoint, this.config.externalCdpTimeoutMs, async () => {})
      session.providerBinding = { kind: 'external-cdp', ...connection, endpoint }
      session.provider = 'external-cdp'
      session.providerEndpoint = endpoint
      await this.bindContext(session)
      await this.restoreTabs(session, tabs)
      return { ok: true, action: 'provider_connect', viewId: session.activeViewId, data: asData(providerState(session)) }
    }
    if (input.action === 'disconnect') {
      for (const view of session.views.values()) {
        await this.releaseViewRefs(view)
      }
      session.views.clear()
      await this.cleanupProvider(session)
      session.providerBinding = { kind: 'disconnected' }
      session.provider = 'disconnected'
      session.providerEndpoint = undefined
      // Nothing can be restored against a disconnected provider: restoring tabs
      // would call createPage and fail with BROWSER_NOT_CONNECTED after the
      // teardown already succeeded.
      session.activeViewId = ''
      session.splitView.enabled = false
      session.splitView.topViewId = undefined
      session.splitView.bottomViewId = undefined
      session.splitView.changedAt = Date.now()
      return { ok: true, action: 'provider_disconnect', viewId: '', data: asData(providerState(session)) }
    }
    fail('INVALID_ARGS', `unknown browser_provider action ${JSON.stringify(input.action)}`)
  }
  // private liveViewport

  protected safeRemoteResult(value: unknown): unknown {
    return safeRemoteResult(value, this.config.maxOutputChars)
  }

  protected async evaluateAction(session: SessionState, input: BrowserEvaluateInput): Promise<ToolOutput> {
    const view = this.view(session, input.viewId)
    const state = await this.cdp(session, view)
    const client = rawCdp(state.session)
    let result: Record<string, unknown>
    if (input.action === 'paused_frame') {
      const callFrameId = input.callFrameId ?? state.callFrames[0]?.callFrameId
      if (callFrameId === undefined || !state.paused) fail('DEBUGGER_NOT_PAUSED', 'paused_frame evaluation requires a paused call frame')
      result = await client.send('Debugger.evaluateOnCallFrame', { callFrameId, expression: input.expression, returnByValue: true, awaitPromise: input.awaitPromise ?? true, silent: true })
    } else if (input.action === 'isolated') {
      await client.send('Page.enable')
      await client.send('Runtime.enable')
      const tree = await client.send('Page.getFrameTree')
      const frameId = string(record(record(tree.frameTree).frame).id)
      const world = await client.send('Page.createIsolatedWorld', { frameId, worldName: 'dsh-browser-tools', grantUniveralAccess: false })
      result = await client.send('Runtime.evaluate', { expression: input.expression, contextId: parseNumber(world.executionContextId), returnByValue: true, awaitPromise: input.awaitPromise ?? true, silent: true })
    } else if (input.action === 'main_world') {
      result = await client.send('Runtime.evaluate', { expression: input.expression, returnByValue: true, awaitPromise: input.awaitPromise ?? true, silent: true })
    } else fail('INVALID_ARGS', `unknown browser_evaluate action ${JSON.stringify(input.action)}`)
    if (result.exceptionDetails !== undefined) return { ok: false, action: 'evaluate', viewId: view.viewId, data: asData({ code: 'EVALUATION_FAILED', recoverable: false, exception: this.safeRemoteResult(result.exceptionDetails) }) }
    const remote = record(result.result)
    return {
      ok: true,
      action: 'evaluate',
      viewId: view.viewId,
      data: asData({
        ...(typeof remote.type === 'string' ? { type: remote.type } : {}),
        ...(typeof remote.subtype === 'string' ? { subtype: remote.subtype } : {}),
        value: this.safeRemoteResult(remote.value ?? remote.description ?? null),
      }),
    }
  }

  protected async createSession(identity: Identity): Promise<SessionState> {
    const key = sessionKey(identity)
    const existing = this.state.sessions.get(key)
    if (existing !== undefined) return existing
    const adopted = await this.adoptPendingSession(identity)
    if (adopted !== undefined) return adopted
    return this.queueSharedContext(async () => {
      const concurrent = this.state.sessions.get(key)
      if (concurrent !== undefined) return concurrent
      const splitPreference = await this.profiles.splitViewPreference(identity.sessionId)
      const session: SessionState = {
        key,
        sessionId: identity.sessionId,
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
        liveView: {
          mode: 'adaptive',
          initialized: false,
          open: false,
          fixedWidth: STANDARD_VIEWPORT.width,
          fixedHeight: STANDARD_VIEWPORT.height,
          changedAt: Date.now(),
        },
        control: {
          owner: 'model',
          pending: false,
          changedAt: Date.now(),
        },
        diagnosticPanel: {
          readSequences: new Map(),
        },
      }
      this.state.sessions.set(key, session)
      await this.bindContext(session)
      return session
    })
  }

  protected async withSession<T>(identity: Identity, signal: AbortSignal, operation: (session: SessionState) => Promise<T>, options: { autoLaunch?: boolean } = {}): Promise<T> {
    requireActive(signal)
    const session = await this.createSession(identity)
    const previous = session.queue
    let release!: () => void
    session.queue = new Promise<void>(resolveQueue => { release = resolveQueue })
    await previous
    const startedAt = Date.now()
    const beforeViews = new Map([...session.views.values()].map(view => [view.viewId, {
      viewId: view.viewId,
      documentGeneration: view.documentGeneration,
      navigationId: view.navigationId,
    }]))
    const beforeActive = beforeViews.get(session.activeViewId)
    try {
      if (options.autoLaunch !== false) await this.ensureAutoProvider(session)
      requireActive(signal)
      const result = await operation(session)
      const toolOutput = typeof result === 'object' && result !== null && 'ok' in result && 'action' in result ? result as ToolOutput : undefined
      const after = session.views.get(toolOutput?.viewId ?? session.activeViewId)
      if (identity.toolName !== undefined && identity.toolName !== 'browser_diagnose' && after !== undefined) {
        const before = beforeViews.get(after.viewId) ?? beforeActive
        const data = record(toolOutput?.data)
        const rawSignals = record(data.changeSignals)
        const changeSignals = Object.fromEntries(Object.entries(rawSignals).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
        const contextIdentity = after.cdp?.contextAdapter?.isEnabled() ? after.cdp.contextAdapter.mainContext() : {}
        const action = this.journal.recordAction({
          sessionId: session.sessionId,
          sessionKey: session.key,
          viewId: after.viewId,
          contextGeneration: session.contextGeneration,
          documentGeneration: after.documentGeneration,
          navigationId: after.navigationId,
          ...contextIdentity,
          callId: identity.callId,
          rootCallId: identity.rootCallId,
          toolName: identity.toolName,
          humanInitiated: false,
          startedAt,
          finishedAt: Date.now(),
          outcome: toolOutput?.ok === false ? 'failed' : 'ok',
          ...(before === undefined ? {} : { beforeViewId: before.viewId, beforeDocumentGeneration: before.documentGeneration, beforeNavigationId: before.navigationId }),
          afterViewId: after.viewId,
          afterDocumentGeneration: after.documentGeneration,
          afterNavigationId: after.navigationId,
          ...(Object.keys(changeSignals).length === 0 ? {} : { changeSignals }),
        })
        this.recorder.record(session.sessionId, session.key, {
          source: 'agent',
          kind: 'action',
          viewId: after.viewId,
          documentGeneration: after.documentGeneration,
          navigationId: after.navigationId,
          ...contextIdentity,
          actionId: action.actionId,
          outcome: action.outcome,
          labels: { toolName: action.toolName },
        })
      }
      return result
    } catch (error) {
      const after = session.views.get(session.activeViewId)
      if (identity.toolName !== undefined && identity.toolName !== 'browser_diagnose' && after !== undefined) {
        const before = beforeViews.get(after.viewId) ?? beforeActive
        const contextIdentity = after.cdp?.contextAdapter?.isEnabled() ? after.cdp.contextAdapter.mainContext() : {}
        const action = this.journal.recordAction({
          sessionId: session.sessionId,
          sessionKey: session.key,
          viewId: after.viewId,
          contextGeneration: session.contextGeneration,
          documentGeneration: after.documentGeneration,
          navigationId: after.navigationId,
          ...contextIdentity,
          callId: identity.callId,
          rootCallId: identity.rootCallId,
          toolName: identity.toolName,
          humanInitiated: false,
          startedAt,
          finishedAt: Date.now(),
          outcome: signal.aborted ? 'aborted' : 'failed',
          ...(before === undefined ? {} : { beforeViewId: before.viewId, beforeDocumentGeneration: before.documentGeneration, beforeNavigationId: before.navigationId }),
          afterViewId: after.viewId,
          afterDocumentGeneration: after.documentGeneration,
          afterNavigationId: after.navigationId,
        })
        this.recorder.record(session.sessionId, session.key, {
          source: 'agent',
          kind: 'action',
          viewId: after.viewId,
          documentGeneration: after.documentGeneration,
          navigationId: after.navigationId,
          ...contextIdentity,
          actionId: action.actionId,
          outcome: action.outcome,
          labels: { toolName: action.toolName },
        })
      }
      throw error
    } finally {
      release()
    }
  }

  protected async runOnPage<T>(session: SessionState, view: ViewState, signal: AbortSignal, operation: Promise<T>): Promise<T> {
    try {
      return await stopOnAbort(view.page, signal, operation)
    } catch (error) {
      if (signal.aborted) {
        await this.refreshPage(session, view.page)
        throw abortReason(signal)
      }
      throw error
    }
  }

  protected async refreshPage(session: SessionState, closed: Page): Promise<ViewState> {
    const old = [...session.views.values()].find(view => view.page === closed)
    if (old !== undefined) {
      await this.releaseViewRefs(old)
      session.views.delete(old.viewId)
    }
    const page = await this.createPage(session)
    const view = this.bindView(session, page)
    session.activeViewId = view.viewId
    return view
  }
}
