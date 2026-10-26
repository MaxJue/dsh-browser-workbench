import { chromium } from 'playwright-core'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { BrowserContext, ElementHandle, Page, Request } from 'playwright-core'
import { fail } from '../domain/errors.ts'
import type { Identity, ResolvedConfig, RuntimeState, SessionState, ToolOutput, ViewState } from '../domain/types.ts'
import type { BrowserSplitViewPane } from '../domain/protocol.ts'
import { ArtifactStore } from '../provider/artifact-store.ts'
import { ChromiumManager } from '../provider/chromium-manager.ts'
import { sessionContext } from '../provider/provider.ts'
import { releaseHandles, releaseViewRefs } from '../view/view-refs.ts'
import { createViewState } from '../view/view-state.ts'
import { splitPaneForView, splitPaneView } from '../view/view-layout.ts'
import { debuggerPauseResponse, resolveRef, resolveView, resolveViewByInput, staleReferenceResponse, userTakeoverResponse } from '../view/view-access.ts'
import { bindPageDiagnosticEvents } from '../page/page-diagnostics.ts'
import { bindPageNetworkEvents } from '../page/page-network-events.ts'
import { recordPageRequest } from '../page/page-network-recording.ts'
import { bindPageDialogEvents } from '../page/page-dialog-events.ts'
import { bindPageLoadEvents } from '../page/page-load-events.ts'
import { bindPageCloseEvents } from '../page/page-close-events.ts'
import { createBoundCdpState } from '../cdp/cdp-session.ts'
import { projectPausedRequests, releasePausedRequests } from '../page/paused-requests.ts'
import { commitMainFrameNavigation } from '../page/navigation-state.ts'
import { browserLaunchNetwork, executablePath, splitViewState } from '../provider/launch-config.ts'
import { PersistentProfileStore } from '../provider/persistent-profile.ts'
import { DebugSessionStore } from '../diagnostics/debug-session-store.ts'
import { EventJournal } from '../diagnostics/event-journal.ts'
import { CdpContextAdapter } from '../diagnostics/cdp-context-adapter.ts'
import { ContextIdentityRegistry } from '../diagnostics/context-registry.ts'
import { FlightRecorderStore } from '../diagnostics/flight-recorder.ts'
import { InputTraceStore } from '../diagnostics/input-trace.ts'
import { BuildRegistry } from '../diagnostics/build-registry.ts'
import { ApplicationRegistry } from '../diagnostics/application-registry.ts'
import type { BrowserControllerIdentity } from '../diagnostics/l3-closure.ts'
import { pendingSessionKey, sessionKey } from '../session/session-key.ts'
import { number, rawCdp, type RawCdpSession } from '../cdp/cdp-raw.ts'
import { queueExclusive, queueExclusiveMany } from '../session/session-queue.ts'

export abstract class BrowserRuntimeFoundation {



  protected readonly state: RuntimeState = {
    sharedPersistent: {
      contextGeneration: 0,
      queue: Promise.resolve(),
      pageCreationQueue: Promise.resolve(),
      pageOwners: new Map(),
      extensionRegistry: [],
      loadedExtensions: [],
      loadedExtensionIds: new Set(),
      restarting: false,
    },
    sessions: new Map(),
    disposed: false,
  }
  protected readonly artifacts: ArtifactStore
  protected readonly profiles: PersistentProfileStore
  protected readonly chromiumManager: ChromiumManager
  protected readonly journal = new EventJournal()
  protected readonly debugSessions = new DebugSessionStore()
  protected readonly contextIdentities = new ContextIdentityRegistry()
  protected readonly recorder = new FlightRecorderStore()
  protected readonly inputTraces = new InputTraceStore()
  protected readonly builds = new BuildRegistry()
  protected readonly applications = new ApplicationRegistry()
  protected controllerIdentityResolver: (sessionId: string) => BrowserControllerIdentity | undefined = () => ({
    id: 'dsh-browser-tools',
    generation: 0,
    registrationMode: 'global',
  })
  protected nextLegacyInputTrace = 1
  protected readonly legacyRequests = new WeakMap<Request, ViewState['network'][number]>()

  constructor(protected readonly config: ResolvedConfig, protected readonly attachments: AttachmentStore) {
    this.artifacts = new ArtifactStore(config.artifactRoot, config.maxArtifactBytes)
    this.profiles = new PersistentProfileStore(config.artifactRoot)
    this.chromiumManager = new ChromiumManager(this.profiles.chromiumPath(), {
      source: config.chromiumDownloadSource,
      timeoutMs: config.chromiumDownloadTimeoutMs,
    })
  }

  setControllerIdentityResolver(resolver: (sessionId: string) => BrowserControllerIdentity | undefined): void {
    // Runtime 鍙鍙栨帶鍒跺櫒韬唤骞跺啓鍏ヨ瘉鎹紝涓嶆寔鏈?Controller Store锛屼篃涓嶅弬涓庡伐鍏锋敞鍐岀姸鎬佹満銆?
    // 璇ュ崟鍚戜緷璧栭伩鍏?Browser Runtime 涓?Agent Scope 鐢熷懡鍛ㄦ湡浜掔浉璋冪敤褰㈡垚寰幆鎵€鏈夋潈銆?
    this.controllerIdentityResolver = resolver
  }

  protected controllerIdentity(sessionId: string): BrowserControllerIdentity | undefined {
    return this.controllerIdentityResolver(sessionId)
  }

  protected async releaseHandles(handles: Iterable<ElementHandle>): Promise<void> {
    // 鍚屼竴涓狤lementHandle鍙兘鐢变竴涓€昏緫鎵€鏈夎€呬繚鐣欙紱鐢⊿et鍘婚噸鍚庣粺涓€閲婃斁锛岄伩鍏峉napshot涓嶲uery寮傚父璺緞閲嶅dispose銆?
    await releaseHandles(handles)
  }

  protected async releaseViewRefs(view: ViewState): Promise<void> {
    // 蹇呴』鍏堝悓姝ユ竻绌篗ap锛屼娇鏃ef绔嬪嵆鍙樹负STALE_REF锛涢殢鍚庡啀绛夊緟鍗忚鍙ユ焺閲婃斁锛岄伩鍏嶆竻鐞嗘湡闂存棫寮曠敤浠嶅彲琚苟鍙戞搷浣滃懡涓€?
    await releaseViewRefs(view)
  }

  protected splitViewState(preference: { ratio: number; orientation: 'top-bottom' | 'left-right' } = { ratio: 0.5, orientation: 'top-bottom' }): SessionState['splitView'] {
    // activeViewId 浠嶆槸鐜版湁宸ュ叿鐨勯粯璁ゆ搷浣滅洰鏍囷紱top/bottom 淇濈暀涓哄吋瀹圭獥鏍艰韩浠斤紝orientation 鍙喅瀹氳瑙夋帓鍒楁柟寮忋€?
    return splitViewState(preference)
  }

  protected browserLaunchNetwork(): {
    args: string[]
    proxy?: { server: string; bypass?: string; username?: string; password?: string }
  } {
    // system 妯″紡涓嶄紶 Playwright proxy锛岃 Chromium 浣跨敤鎿嶄綔绯荤粺浠ｇ悊锛沝irect 鍙坊鍔犲畼鏂圭洿杩炲弬鏁帮紱
    // custom 閫氳繃 Playwright 鍘熺敓浠ｇ悊瀵硅薄浼犻€掞紝瀵嗙爜涓嶄細杩涘叆鍛戒护琛屻€佹棩蹇楁垨椤甸潰鍙 URL銆?
    return browserLaunchNetwork(this.config)
  }

  protected executablePath(): string | undefined {
    return executablePath(this.config)
  }

  protected async installSurfaceProbe(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
      const key = '__dshShadowHostModes'
      const root = globalThis as typeof globalThis & { [key: string]: unknown }
      if (root[key] instanceof WeakMap) return
      const modes = new WeakMap<Element, ShadowRootMode>()
      root[key] = modes
      const original = Element.prototype.attachShadow
      Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit): ShadowRoot {
        const shadow = original.call(this, init)
        modes.set(this, init.mode)
        return shadow
      }
    })
  }

  protected sessionContext(session: SessionState): BrowserContext {
    return sessionContext(session, this.state.sharedPersistent.context)
  }

  protected async queueSharedContext<T>(operation: () => Promise<T>): Promise<T> {
    const shared = this.state.sharedPersistent
    return queueExclusive(shared, async () => {
      if (this.state.disposed) fail('PROVIDER_UNAVAILABLE', 'browser provider is disposed')
      return await operation()
    })
  }

  protected async queueSharedPageCreation<T>(operation: () => Promise<T>): Promise<T> {
    const shared = this.state.sharedPersistent
    return queueExclusive({ get queue() { return shared.pageCreationQueue }, set queue(value) { shared.pageCreationQueue = value } }, operation)
  }

  protected async queueSessions<T>(sessions: readonly SessionState[], operation: () => Promise<T>): Promise<T> {
    return queueExclusiveMany(sessions, state => (state as SessionState).key, operation)
  }

  protected async queueSession<T>(session: SessionState, operation: () => Promise<T>): Promise<T> {
    return queueExclusive(session, operation)
  }

  protected abstract syncScreencasts(session: SessionState): Promise<void>
  protected abstract applyLiveViewport(session: SessionState, view: ViewState): Promise<void>
  protected abstract forceStopScreencast(view: ViewState): Promise<void>

  protected splitPaneView(session: SessionState, pane: BrowserSplitViewPane): ViewState | undefined {
    return splitPaneView(session, pane)
  }

  protected splitPaneForView(session: SessionState, viewId: string): BrowserSplitViewPane | undefined {
    return splitPaneForView(session, viewId)
  }

  protected ref(view: ViewState, value: string) {
    return resolveRef(view, value)
  }

  protected view(session: SessionState, viewId?: string): ViewState {
    return resolveView(session, viewId)
  }

  protected viewByInput(session: SessionState, viewId?: string, index?: number): ViewState {
    return resolveViewByInput(session, viewId, index)
  }

  protected paused(view: ViewState, action: string): ToolOutput | undefined {
    return debuggerPauseResponse(view, action)
  }

  protected modelWriteBlocked(session: SessionState, view: ViewState, action: string): ToolOutput | undefined {
    return userTakeoverResponse(session, view, action)
  }

  protected stale(view: ViewState, action: string): ToolOutput {
    return staleReferenceResponse(view, action)
  }

  protected async persistentContext(sessionId: string, profileName = 'default', launchExtensions?: readonly SessionState['extensionRegistry'][number][]): Promise<{ context: BrowserContext; extensionRegistry: SessionState['extensionRegistry']; loadedExtensions: SessionState['loadedExtensions']; loadedExtensionIds: Set<string> }> {
    const extensions = await this.profiles.listExtensions(sessionId)
    const enabled = launchExtensions === undefined ? extensions.filter(extension => extension.enabled) : [...launchExtensions]
    const executablePath = enabled.length === 0
      ? this.executablePath()
      : await this.chromiumManager.ensureInstalled()
    const extensionPaths = enabled.map(extension => extension.path)
    const network = this.browserLaunchNetwork()
    const context = await chromium.launchPersistentContext(this.profiles.profilePath(sessionId, profileName), {
      ...(executablePath === undefined ? {} : { executablePath }),
      headless: this.config.headless,
      acceptDownloads: true,
      serviceWorkers: 'allow',
      ...(network.proxy === undefined ? {} : { proxy: network.proxy }),
      args: [
        ...network.args,
        ...(extensionPaths.length === 0
          ? []
          : [
              `--disable-extensions-except=${extensionPaths.join(',')}`,
              `--load-extension=${extensionPaths.join(',')}`,
            ]),
      ],
    })
    await this.installSurfaceProbe(context)
    // 鍙湁鏂?Context 宸茬粡鎴愬姛鍔犺浇鐩爣鎵╁睍鍚庯紝鎵嶈兘鍒犻櫎涓嶅啀鐧昏鎴栦笉鍐嶈繍琛岀殑鏃х増鏈洰褰曪紝纭繚鍚姩澶辫触浠嶅彲浣跨敤鏃х増鏈洖婊氥€?
    await this.profiles.pruneExtensionDirectories(sessionId, [...extensions, ...enabled])
    return { context, extensionRegistry: extensions, loadedExtensions: enabled, loadedExtensionIds: new Set(enabled.map(extension => extension.extensionId)) }
  }

  protected async launchSharedPersistentContext(launchExtensions?: readonly SessionState['extensionRegistry'][number][]): Promise<BrowserContext> {
    const shared = this.state.sharedPersistent
    await this.profiles.ensureSharedProfileSeed(this.config.sharedProfileSeedSessionId)
    const extensions = await this.profiles.listSharedExtensions()
    const enabled = launchExtensions === undefined ? extensions.filter(extension => extension.enabled) : [...launchExtensions]
    const executablePath = enabled.length === 0
      ? this.executablePath()
      : await this.chromiumManager.ensureInstalled()
    const extensionPaths = enabled.map(extension => extension.path)
    const network = this.browserLaunchNetwork()
    const context = await chromium.launchPersistentContext(this.profiles.sharedProfilePath(), {
      ...(executablePath === undefined ? {} : { executablePath }),
      headless: this.config.headless,
      acceptDownloads: true,
      serviceWorkers: 'allow',
      ...(network.proxy === undefined ? {} : { proxy: network.proxy }),
      args: [
        ...network.args,
        ...(extensionPaths.length === 0
          ? []
          : [
              `--disable-extensions-except=${extensionPaths.join(',')}`,
              `--load-extension=${extensionPaths.join(',')}`,
            ]),
      ],
    })
    await this.installSurfaceProbe(context)
    shared.context = context
    shared.contextGeneration += 1
    shared.extensionRegistry = extensions
    shared.loadedExtensions = enabled
    shared.loadedExtensionIds = new Set(enabled.map(extension => extension.extensionId))
    shared.pageOwners.clear()
    shared.pendingPageCreation = undefined
    context.on('page', page => { void this.routeSharedPage(page) })
    for (const page of context.pages()) await page.close({ runBeforeUnload: false }).catch(() => {})
    return context
  }

  protected async sharedPersistentContext(): Promise<BrowserContext> {
    const shared = this.state.sharedPersistent
    if (shared.context !== undefined) return shared.context
    if (shared.launch === undefined) {
      shared.launch = this.launchSharedPersistentContext().finally(() => {
        shared.launch = undefined
      })
    }
    return shared.launch
  }

  protected async cleanupProvider(session: SessionState): Promise<void> {
    this.debugSessions.invalidate(session.key)
    this.contextIdentities.invalidateSession(session.key, session.contextGeneration + 1)
    this.builds.clearSession(session.key)
    this.applications.clearSession(session.key)
    session.diagnosticPanel.readSequences.clear()
    session.diagnosticPanel.latestInspect = undefined
    session.diagnosticPanel.latestComparison = undefined
    session.diagnosticPanel.latestIncident = undefined
    session.diagnosticPanel.takeover = undefined
    session.diagnosticPanel.latestTakeoverSummary = undefined
    session.contextGeneration += 1
    const context = session.providerBinding.kind === 'disconnected'
      ? undefined
      : session.providerBinding.kind === 'shared-persistent'
        ? this.state.sharedPersistent.context
        : session.providerBinding.context
    if (session.playwrightTraceViewId !== undefined) {
      await context?.tracing.stop().catch(() => {})
      session.playwrightTraceViewId = undefined
    }
    const views = [...session.views.values()]
    for (const view of views) {
      await this.releaseViewRefs(view)
      await this.releasePausedRequests(view)
      const cdp = view.cdp
      if (cdp !== undefined) {
        await this.forceStopScreencast(view)
        cdp.contextAdapter?.dispose()
        await rawCdp(cdp.session).detach().catch(() => {})
      }
    }
    session.views.clear()
    if (session.providerBinding.kind === 'shared-persistent') {
      // Session鍙嫢鏈夊叡浜獵ontext涓殑Page锛涢€€鍑哄叡浜玃rovider鎴栭攢姣丼ession鏃堕€愰〉鍏抽棴锛屼笉鑳藉叧闂彃浠剁骇Context銆?
      for (const view of views) {
        this.state.sharedPersistent.pageOwners.delete(view.page)
        await view.page.close({ runBeforeUnload: false }).catch(() => {})
      }
    } else if (session.providerBinding.kind === 'external-cdp') {
      // connectOverCDP 鐨?Browser.close 浠呭叧闂?Playwright 浼犺緭杩炴帴锛屼笉鍙戦€?Browser.close锛屽洜姝や笉浼氶€€鍑虹敤鎴锋祻瑙堝櫒銆?
      await session.providerBinding.browser.close().catch(() => {})
    } else if (session.providerBinding.kind !== 'disconnected') {
      await session.providerBinding.context.close().catch(() => {})
    }
    session.providerBrowser = undefined
    session.providerEndpoint = undefined
    session.persistentProfile = undefined
    session.loadedExtensions = []
    session.loadedExtensionIds = new Set()
    session.openingExtensionPopup = undefined
    session.extensionPopup = undefined
  }

  protected acceptPage(session: SessionState, page: Page, kind: ViewState['kind'] = 'page'): ViewState {
    const popupRequest = kind === 'extension-popup' ? session.openingExtensionPopup : undefined
    if (popupRequest !== undefined) {
      const popupView = this.bindView(session, page, 'extension-popup')
      session.extensionPopup = { ...popupRequest, view: popupView }
      return popupView
    }
    const existing = [...session.views.values()].find(view => view.page === page)
    if (existing !== undefined) return existing
    const view = this.bindView(session, page, kind)
    if (kind === 'page') {
      if (session.splitView.enabled) {
        // 缃戦〉寮瑰嚭鏍囩蹇呴』杩涘叆褰撳墠鐒︾偣绐楁牸锛涘惁鍒欏垎灞忕姸鎬佷粛鎸囧悜鏃ф爣绛撅紝鍦板潃鏍忎笌 Agent 榛樿鐩爣浼氬拰鐢ㄦ埛鐪嬪埌鐨勯〉闈笉涓€鑷淬€?
        if (session.splitView.focusedPane === 'top') session.splitView.topViewId = view.viewId
        else session.splitView.bottomViewId = view.viewId
      }
      session.activeViewId = view.viewId
      void (async () => {
        await this.applyLiveViewport(session, view)
        await this.syncScreencasts(session)
      })().catch(() => {})
    }
    return view
  }

  protected async routeSharedPage(page: Page): Promise<void> {
    const shared = this.state.sharedPersistent
    let owner = shared.pageOwners.get(page)
    if (owner === undefined) {
      const opener = await page.opener().catch(() => null)
      owner = opener === null ? shared.pendingPageCreation : shared.pageOwners.get(opener)
    }
    if (owner === undefined) {
      await page.close({ runBeforeUnload: false }).catch(() => {})
      return
    }
    shared.pageOwners.set(page, owner)
    const session = this.state.sessions.get(owner.sessionKey)
    if (session === undefined || session.providerBinding.kind !== 'shared-persistent') {
      shared.pageOwners.delete(page)
      await page.close({ runBeforeUnload: false }).catch(() => {})
      return
    }
    this.acceptPage(session, page, owner.kind)
  }

  protected async createSharedPageUnlocked(session: SessionState, kind: ViewState['kind'] = 'page'): Promise<Page> {
    const shared = this.state.sharedPersistent
    const context = await this.sharedPersistentContext()
    const owner = { sessionKey: session.key, kind }
    shared.pendingPageCreation = owner
    try {
      const page = await context.newPage()
      shared.pageOwners.set(page, owner)
      this.acceptPage(session, page, kind)
      return page
    } finally {
      if (shared.pendingPageCreation === owner) shared.pendingPageCreation = undefined
    }
  }

  protected async createSharedPage(session: SessionState, kind: ViewState['kind'] = 'page'): Promise<Page> {
    return this.queueSharedPageCreation(() => this.createSharedPageUnlocked(session, kind))
  }

  protected sessionPages(session: SessionState): Page[] {
    return [...session.views.values()]
      .filter(view => view.kind === 'page' && !view.page.isClosed())
      .map(view => view.page)
  }

  protected async createPage(session: SessionState, kind: ViewState['kind'] = 'page'): Promise<Page> {
    if (session.providerBinding.kind === 'shared-persistent') return this.createSharedPage(session, kind)
    const page = await this.sessionContext(session).newPage()
    this.acceptPage(session, page, kind)
    return page
  }

  protected sharedSessions(): SessionState[] {
    return [...this.state.sessions.values()].filter(session => session.providerBinding.kind === 'shared-persistent')
  }

  protected syncSharedExtensions(): void {
    const shared = this.state.sharedPersistent
    for (const session of this.sharedSessions()) {
      // Session瀛楁鍙繚鐣欏吋瀹瑰揩鐓э紝绂佹鍏变韩Set寮曠敤锛汸rovider鍒囨崲鏃舵竻鐞哠ession涓嶈兘淇敼鎻掍欢绾у姞杞介泦鍚堛€?
      session.extensionRegistry = [...shared.extensionRegistry]
      session.loadedExtensions = [...shared.loadedExtensions]
      session.loadedExtensionIds = new Set(shared.loadedExtensionIds)
    }
  }

  protected extensionRegistry(session: SessionState): SessionState['extensionRegistry'] {
    return session.providerBinding.kind === 'shared-persistent'
      ? this.state.sharedPersistent.extensionRegistry
      : session.extensionRegistry
  }

  protected loadedExtensions(session: SessionState): SessionState['loadedExtensions'] {
    return session.providerBinding.kind === 'shared-persistent'
      ? this.state.sharedPersistent.loadedExtensions
      : session.loadedExtensions
  }

  protected loadedExtensionIds(session: SessionState): Set<string> {
    return session.providerBinding.kind === 'shared-persistent'
      ? this.state.sharedPersistent.loadedExtensionIds
      : session.loadedExtensionIds
  }

  protected async bindContext(session: SessionState): Promise<void> {
    if (session.providerBinding.kind === 'disconnected') return
    const context = this.sessionContext(session)
    if (session.providerBinding.kind === 'shared-persistent') {
      const page = await this.createSharedPage(session)
      const view = this.bindView(session, page)
      session.activeViewId = view.viewId
      await this.applyLiveViewport(session, view)
      return
    }
    context.on('page', page => { this.acceptPage(session, page) })
    for (const page of context.pages()) this.bindView(session, page)
    const page = context.pages().find(item => this.bindView(session, item).kind === 'page') ?? await context.newPage()
    const view = this.bindView(session, page)
    session.activeViewId = view.viewId
    await this.applyLiveViewport(session, view)
  }

  protected bindView(session: SessionState, page: Page, kind: ViewState['kind'] = 'page'): ViewState {
    const existing = [...session.views.values()].find(view => view.page === page)
    if (existing !== undefined) return existing
    const viewId = `v${session.nextViewId++}`
    const view = createViewState(viewId, page, kind)
    session.views.set(view.viewId, view)
    bindPageDiagnosticEvents(page, session, view, this.config.maxOutputChars, this.journal, this.recorder)
    bindPageNetworkEvents(page, session, view, this.legacyRequests, this.journal, this.recorder, request => recordPageRequest(session, view, request, this.legacyRequests, this.journal))
    bindPageDialogEvents(page, view)
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame()) return
      const navigation = commitMainFrameNavigation(view)
      this.builds.invalidateDocument(session.key, view.viewId, view.documentGeneration)
      this.debugSessions.updateDocument(session.key, view.documentGeneration, view.navigationId)
      void this.releaseViewRefs(view)
      const mainIdentity = view.cdp?.contextAdapter?.isEnabled() ? view.cdp.contextAdapter.mainContext() : {}
      this.recorder.record(session.sessionId, session.key, {
        source: 'page',
        kind: 'navigation',
        viewId: view.viewId,
        documentGeneration: navigation.documentGeneration,
        navigationId: navigation.navigationId,
        ...mainIdentity,
        outcome: 'committed',
      })
    })
    bindPageLoadEvents(page, session, view, (target, operation) => this.queueSession(target, operation), (target, current) => this.applyLiveViewport(target, current))
    bindPageCloseEvents(page, session, view, {
      releaseViewRefs: current => this.releaseViewRefs(current),
      removeContextIdentity: (sessionKey, viewId) => this.contextIdentities.removeView(sessionKey, viewId),
      deactivateView: (sessionKey, viewId) => this.applications.deactivateView(sessionKey, viewId),
      invalidateDebugger: (sessionKey, viewId) => {
        if (this.debugSessions.get(sessionKey)?.viewId === viewId) this.debugSessions.invalidate(sessionKey)
      },
      splitPaneForView: (target, viewId) => this.splitPaneForView(target, viewId),
      splitPaneView: (target, pane) => this.splitPaneView(target, pane),
      applyLiveViewport: (target, current) => this.applyLiveViewport(target, current),
      queueSession: (target, operation) => this.queueSession(target, operation),
      syncScreencasts: target => this.syncScreencasts(target),
    })
    return view
  }

  protected sessionById(sessionId: string): SessionState | undefined {
    return [...this.state.sessions.values()].find(session => session.key.startsWith(`${sessionId}@`))
  }

  protected async adoptPendingSession(identity: Identity): Promise<SessionState | undefined> {
    const pendingKey = pendingSessionKey(identity.sessionId)
    const pending = this.state.sessions.get(pendingKey)
    if (pending === undefined) return undefined
    const key = sessionKey(identity)
    const existing = this.state.sessions.get(key)
    if (existing !== undefined) {
      await this.cleanupProvider(pending)
      await this.artifacts.removeSession(pendingKey)
      this.state.sessions.delete(pendingKey)
      return existing
    }
    await this.queueSession(pending, async () => {
      await this.artifacts.migrateSession(pendingKey, key)
      this.journal.migrateSession(pendingKey, key)
      this.contextIdentities.migrateSession(pendingKey, key)
      this.recorder.migrateSession(pendingKey, key)
      this.inputTraces.migrateSession(pendingKey, key)
      this.builds.migrateSession(pendingKey, key)
      this.applications.migrateSession(pendingKey, key)
      this.state.sessions.delete(pendingKey)
      pending.key = key
      this.state.sessions.set(key, pending)
      if (pending.providerBinding.kind === 'shared-persistent') {
        // 鑽夌鎺ョ涓嶉噸寤篜age锛涘彧鎶婂叡浜玂wner閿粠@pending鍘熷瓙鏀逛负姝ｅ紡Session閿紝鐜版湁View銆佺櫥褰曟€佸拰瀹炲喌缁х画淇濈暀銆?
        for (const [page, owner] of this.state.sharedPersistent.pageOwners) {
          if (owner.sessionKey === pendingKey) this.state.sharedPersistent.pageOwners.set(page, { ...owner, sessionKey: key })
        }
      }
    })
    return pending
  }

  protected async cdp(sessionState: SessionState, view: ViewState): Promise<NonNullable<ViewState['cdp']>> {
    if (view.cdp !== undefined) return view.cdp
    const session = await view.page.context().newCDPSession(view.page)
    const client = rawCdp(session)
    const state = createBoundCdpState({
      session: sessionState,
      view,
      client,
      journal: this.journal,
      interceptionTimeoutMs: this.config.interceptionTimeoutMs,
      maxArtifactBytes: this.config.maxArtifactBytes,
      createContextAdapter: (current, target, cdp) => this.createContextAdapter(current, target, cdp),
      registerBuildScript: (sessionKey, script) => this.builds.registerScript(sessionKey, script),
      deactivateExecutionContext: (sessionKey, executionContextId) => this.builds.deactivateExecutionContext(sessionKey, executionContextId),
      deactivateTarget: (sessionKey, targetId) => this.builds.deactivateTarget(sessionKey, targetId),
      recorderStatus: current => this.recorder.status(current.sessionId, current.key),
      recordVisualFrame: (session, current, cdpState, metadata) => {
        const mainIdentity = cdpState.contextAdapter?.isEnabled() ? cdpState.contextAdapter.mainContext() : {}
        this.recorder.record(session.sessionId, session.key, {
          source: 'system',
          kind: 'visual-frame',
          viewId: current.viewId,
          documentGeneration: current.documentGeneration,
          navigationId: current.navigationId,
          ...mainIdentity,
          metrics: {
            width: number(metadata.deviceWidth),
            height: number(metadata.deviceHeight),
            frameSequence: cdpState.frameSequence,
            viewportGeneration: current.viewport.generation,
          },
        })
      },
    })
    view.cdp = state
    return state
  }

  protected createContextAdapter(session: SessionState, view: ViewState, client: RawCdpSession): CdpContextAdapter {
    return new CdpContextAdapter(client, this.contextIdentities, {
      sessionId: session.sessionId,
      sessionKey: session.key,
      viewId: view.viewId,
      browserContextGeneration: session.contextGeneration,
      owner: session.provider === 'external-cdp' ? 'external' : session.provider === 'managed' ? 'managed' : 'persistent',
    })
  }

  protected async ensureContextIdentity(session: SessionState, view: ViewState): Promise<NonNullable<ViewState['cdp']>> {
    const state = await this.cdp(session, view)
    if (state.contextAdapter === undefined || state.contextAdapter.isDisposed()) {
      state.contextAdapter = this.createContextAdapter(session, view, rawCdp(state.session))
    }
    await state.contextAdapter.enable()
    if (!state.debuggerEnabled) {
      await rawCdp(state.session).send('Debugger.enable')
      state.debuggerEnabled = true
    }
    return state
  }

  protected pausedRequests(view: ViewState) {
    return projectPausedRequests(view)
  }

  protected async releasePausedRequests(view: ViewState): Promise<void> {
    await releasePausedRequests(view)
  }
}

