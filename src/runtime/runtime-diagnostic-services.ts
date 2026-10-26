import { createHash } from 'node:crypto'
import { fail } from '../domain/errors.ts'
import { assertUrlAllowed, redactUrl } from '../domain/policy.ts'
import type {
  BrowserDiagnoseInput,
  BrowserDiagnosticPanelSnapshot,
  BrowserRecorderInput,
} from '../domain/protocol.ts'
import type { SessionState, ToolOutput, ViewState } from '../domain/types.ts'
import type { ApplicationIdentity } from '../diagnostics/application-registry.ts'
import { DebugSessionStore, type DiagnosticCheckpoint, type ElementEvidence } from '../diagnostics/debug-session-store.ts'
import { diagnosticLifecycleAction } from '../diagnostics/diagnostic-lifecycle.ts'
import {
  compareCheckpoints,
  projectActionTimeline,
  projectCorrelations,
  projectDiagnosticCompareOutput,
  projectEvidence,
} from '../diagnostics/diagnostic-projector.ts'
import { diagnosticRange as projectDiagnosticRange } from '../diagnostics/diagnostic-range.ts'
import { elementApplication, inspectElement, refreshApplications } from '../diagnostics/element-inspector.ts'
import type { ActionJournalEvent, ConsoleJournalEvent } from '../diagnostics/event-journal.ts'
import { buildIncidentReport } from '../diagnostics/incident-report.ts'
import {
  buildCrossContextLinks,
  compareL3Checkpoints,
  createL3Checkpoint,
} from '../diagnostics/l3-closure.ts'
import { parseGeneratedLocation, resolveSourceMap } from '../diagnostics/source-map-resolver.ts'
import { rawCdp, string } from '../cdp/cdp-raw.ts'
import { BrowserRuntimeInteractionServices } from './runtime-interaction-services.ts'

function asData(value: unknown): ToolOutput['data'] {
  return value as ToolOutput['data']
}

export class BrowserRuntimeDiagnosticServices extends BrowserRuntimeInteractionServices {
  protected async inspectElement(view: ViewState, ref: string): Promise<ElementEvidence> {
    return inspectElement(view, ref, (targetView, targetRef) => this.ref(targetView, targetRef))
  }

  protected async refreshApplications(session: SessionState, view: ViewState): Promise<ApplicationIdentity[]> {
    return refreshApplications(session, view, this.applications, this.builds)
  }

  protected async elementApplication(session: SessionState, view: ViewState, ref: string): Promise<ElementEvidence['application']> {
    return elementApplication(session, view, ref, (targetView, targetRef) => this.ref(targetView, targetRef), this.applications, this.builds)
  }

  protected debugSessionView(session: SessionState, input: BrowserDiagnoseInput): { record: ReturnType<DebugSessionStore['require']>; view: ViewState } {
    const debugSession = this.debugSessions.get(session.key)
    if (debugSession === undefined) fail('INVALID_ARGS', 'browser diagnose session is not active; call browser_diagnose with action start')
    if (debugSession.contextGeneration !== session.contextGeneration) {
      this.debugSessions.invalidate(session.key)
      fail('INVALID_ARGS', 'browser diagnose session became stale after the browser context changed; start a new diagnose session')
    }
    const requestedViewId = input.viewId?.trim()
    if (requestedViewId !== undefined && requestedViewId !== '' && requestedViewId !== debugSession.viewId) {
      fail('INVALID_ARGS', `browser diagnose session is bound to view ${debugSession.viewId}`)
    }
    const view = session.views.get(debugSession.viewId)
    if (view === undefined || view.page.isClosed()) {
      this.debugSessions.invalidate(session.key)
      fail('UNKNOWN_VIEW', 'browser diagnose target view is no longer available; start a new diagnose session')
    }
    return { record: debugSession, view }
  }

  protected checkpointCursor(sessionKey: string): number {
    const checkpoints = this.debugSessions.checkpoints(sessionKey)
    return checkpoints.at(-1)?.cursor.sequence ?? this.debugSessions.require(sessionKey).startedCursor.sequence
  }

  protected diagnosticContext(session: SessionState, view: ViewState, debugSession: ReturnType<DebugSessionStore['require']>) {
    const contextIdentity = view.cdp?.contextAdapter?.isEnabled() ? view.cdp.contextAdapter.mainContext() : {}
    return {
      schemaVersion: 2 as const,
      debugSessionId: debugSession.debugSessionId,
      dshSessionId: debugSession.dshSessionId,
      viewId: view.viewId,
      contextGeneration: session.contextGeneration,
      documentGeneration: view.documentGeneration,
      navigationId: view.navigationId,
      ...contextIdentity,
      status: debugSession.status,
    }
  }

  protected panelDiagnosticSnapshot(session: SessionState, view: ViewState): BrowserDiagnosticPanelSnapshot {
    const debugSession = this.debugSessions.get(session.key)
    const events = this.journal.events(session.key, 0, view.viewId)
    const currentEvents = events.filter(event => event.contextGeneration === session.contextGeneration
      && event.documentGeneration === view.documentGeneration
      && event.navigationId === view.navigationId)
    const abnormalEvents = currentEvents.filter(event => event.kind === 'console'
      ? event.severity === 'error'
      : event.kind === 'network' && (event.failure !== undefined || (event.status !== undefined && event.status >= 400)))
    const readSequence = session.diagnosticPanel.readSequences.get(view.viewId) ?? 0
    const unreadEvents = abnormalEvents.filter(event => event.sequence > readSequence)
    const unreadConsoleErrors = unreadEvents.filter(event => event.kind === 'console').length
    const unreadFailedRequests = unreadEvents.filter(event => event.kind === 'network').length
    const reasons: string[] = []
    if (debugSession !== undefined) {
      if (debugSession.viewId !== view.viewId) reasons.push('viewId differs')
      if (debugSession.contextGeneration !== session.contextGeneration) reasons.push('contextGeneration differs')
    }

    const contextIdentity = view.cdp?.contextAdapter?.isEnabled() ? view.cdp.contextAdapter.mainContext() : {}
    const currentIdentity = {
      viewId: view.viewId,
      contextGeneration: session.contextGeneration,
      documentGeneration: view.documentGeneration,
      navigationId: view.navigationId,
      ...contextIdentity,
      viewport: {
        width: view.viewport.width,
        height: view.viewport.height,
        deviceScaleFactor: view.viewport.deviceScaleFactor,
        mobile: view.viewport.mobile,
        generation: view.viewport.generation,
      },
    }

    const contextTopologySnap = view.cdp?.contextAdapter?.isEnabled()
      ? this.contextIdentities.snapshot(session.key)
      : undefined

    const mainFrameId = contextTopologySnap?.frames.find(frame => frame.mainFrame)?.frameId
    const isTruncated = contextTopologySnap === undefined ? false : Boolean(
      contextTopologySnap.truncated.targets
      || contextTopologySnap.truncated.frames
      || contextTopologySnap.truncated.documents
      || contextTopologySnap.truncated.executionContexts
      || contextTopologySnap.truncated.degradations,
    )
    const contextTopology = contextTopologySnap === undefined ? undefined : {
      contextTopologySchemaVersion: 1 as const,
      targetCount: contextTopologySnap.targets.length,
      frameCount: contextTopologySnap.frames.length,
      executionContextCount: contextTopologySnap.executionContexts.length,
      degradationCount: contextTopologySnap.degradations.length,
      ...(mainFrameId === undefined ? {} : { mainFrameId }),
      truncated: isTruncated,
    }

    const buildSnap = this.builds.snapshot(session.key)
    const buildTopology = {
      buildCount: buildSnap.builds.length,
      activeBuildCount: buildSnap.builds.length,
      scriptCount: buildSnap.scripts.length,
      truncated: buildSnap.truncated,
    }

    const appSnap = this.applications.snapshot(session.key)
    const applicationTopology = {
      applicationCount: appSnap.applications.length,
      activeApplicationCount: appSnap.applications.filter(item => item.active).length,
      confirmedApplicationCount: appSnap.applications.filter(item => item.confidence === 'confirmed').length,
      truncated: appSnap.truncated,
    }

    const recorderSnap = this.recorder.snapshot(session.key)
    const recorder = {
      ...recorderSnap,
      deepVisible: recorderSnap.mode === 'deep',
      visualCapture: this.visualCaptureState(session),
    }

    const checkpoints = debugSession === undefined ? [] : this.debugSessions.checkpoints(session.key)
    const lastCheckpoint = checkpoints.at(-1)
    const debugSessionSnapshot = debugSession === undefined ? undefined : {
      debugSessionId: debugSession.debugSessionId,
      status: debugSession.status,
      startedAt: debugSession.startedAt,
      checkpointCount: checkpoints.length,
      checkpoints: checkpoints.map(cp => ({
        checkpointId: cp.checkpointId,
        label: cp.label,
        createdAt: cp.createdAt,
        viewId: cp.viewId,
        documentGeneration: cp.documentGeneration,
        navigationId: cp.navigationId,
      })),
      currentCheckpoint: lastCheckpoint === undefined ? undefined : {
        checkpointId: lastCheckpoint.checkpointId,
        label: lastCheckpoint.label,
        createdAt: lastCheckpoint.createdAt,
      },
    }

    const timeline = (this.journal.events(session.key, 0, view.viewId)
      .filter((event): event is ActionJournalEvent => event.kind === 'action'))
      .slice(-20)
      .map(action => ({
        actionId: action.actionId,
        toolName: action.toolName,
        humanInitiated: action.humanInitiated,
        outcome: action.outcome,
        wallTime: action.wallTime,
        documentGeneration: action.documentGeneration,
        navigationId: action.navigationId,
        relatedEvidenceCount: action.relatedEventIds.length,
      }))

    return {
      schemaVersion: 2 as const,
      active: debugSession !== undefined && reasons.length === 0,
      recording: this.recorder.status(session.sessionId, session.key).status === 'recording',
      currentIdentity,
      ...(contextTopology === undefined ? {} : { contextTopology }),
      buildTopology,
      applicationTopology,
      recorder,
      debugSession: debugSessionSnapshot,
      synchronization: {
        status: debugSession === undefined ? ('no-debug-session' as const) : reasons.length === 0 ? ('same-view' as const) : ('mismatch' as const),
        reasons,
      },
      unread: {
        consoleErrors: unreadConsoleErrors,
        failedRequests: unreadFailedRequests,
        total: unreadEvents.length,
        latestSequence: unreadEvents.at(-1)?.sequence ?? readSequence,
      },
      timeline,
      latestInspect: session.diagnosticPanel.latestInspect,
      latestComparison: session.diagnosticPanel.latestComparison,
      latestIncident: session.diagnosticPanel.latestIncident,
    }
  }

  protected diagnosticRange(session: SessionState, view: ViewState, input: BrowserDiagnoseInput, defaultAfterSequence: number) {
    return projectDiagnosticRange(session, view, input, defaultAfterSequence, this.journal, this.debugSessions)
  }

  protected async diagnosticScreenshot(view: ViewState) {
    const sensitive = view.page.locator([
      'input',
      'textarea',
      '[contenteditable]:not([contenteditable="false"])',
      '[data-dsh-sensitive]',
      '[autocomplete*="password" i]',
      '[autocomplete*="one-time-code" i]',
      '[name*="password" i]',
      '[name*="otp" i]',
      '[name*="verification" i]',
      '[name*="captcha" i]',
      '[name*="card" i]',
      '[id*="password" i]',
      '[id*="otp" i]',
      '[id*="verification" i]',
      '[id*="captcha" i]',
      '[id*="card" i]',
      '[aria-label*="password" i]',
      '[aria-label*="otp" i]',
      '[aria-label*="verification" i]',
      '[aria-label*="captcha" i]',
      '[aria-label*="security challenge" i]',
      '[aria-label*="card" i]',
    ].join(','))
    return view.page.screenshot({
      type: 'png',
      fullPage: false,
      mask: [sensitive],
      maskColor: '#5b21b6',
    })
  }

  protected async diagnosticCheckpoint(session: SessionState, input: BrowserDiagnoseInput): Promise<DiagnosticCheckpoint> {
    const { view } = this.debugSessionView(session, input)
    const ref = input.ref?.trim()
    const element = ref === undefined || ref === '' ? undefined : await this.inspectElement(view, ref)
    if (element !== undefined && ref !== undefined && ref !== '') {
      const application = await this.elementApplication(session, view, ref)
      if (application !== undefined) element.application = application
    }
    const cursor = this.journal.cursor(session.key)
    const { events, range } = this.diagnosticRange(session, view, input, this.checkpointCursor(session.key))
    const rootScrollWidth = await view.page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0, innerWidth)).catch(() => view.viewport.width)
    const scroll = await view.page.evaluate(() => ({ x: scrollX, y: scrollY })).catch(() => ({ x: 0, y: 0 }))
    const screenshot = input.screenshot === true
      ? await this.diagnosticScreenshot(view).then(data => this.attachments.saveImage({ data, mediaType: 'image/png', name: `browser-diagnose-${view.viewId}.png` }))
      : undefined
    const contextTopology = view.cdp?.contextAdapter?.isEnabled() ? view.cdp.contextAdapter.snapshot() : undefined
    const recorder = this.recorder.status(session.sessionId, session.key)
    const buildTopology = this.builds.snapshot(session.key)
    const applications = await this.refreshApplications(session, view)
    const controllerIdentity = this.controllerIdentity(session.sessionId)
    const l3 = createL3Checkpoint({
      ...(controllerIdentity === undefined ? {} : { controllerIdentity }),
      ...(contextTopology === undefined ? {} : { contextTopology }),
      recorder,
      builds: buildTopology.builds,
      applications,
      ...(element?.application?.applicationId === undefined ? {} : { selectedApplicationId: element.application.applicationId }),
      ...(element?.surface === undefined ? {} : { surface: element.surface }),
      degradations: contextTopology?.degradations.map(item => item.code) ?? [],
    })
    return this.debugSessions.checkpoint(session.key, {
      label: input.label?.trim().slice(0, 160) || `checkpoint-${Date.now()}`,
      createdAt: Date.now(),
      viewId: view.viewId,
      contextGeneration: session.contextGeneration,
      documentGeneration: view.documentGeneration,
      navigationId: view.navigationId,
      cursor,
      journalRange: {
        afterSequence: range.afterSequence,
        untilSequence: cursor.sequence,
        eventCount: events.length,
      },
      environment: {
        provider: session.provider,
        controlOwner: session.control.owner,
        url: redactUrl(view.page.url()),
        viewport: { width: view.viewport.width, height: view.viewport.height, generation: view.viewport.generation },
        deviceScaleFactor: view.viewport.deviceScaleFactor,
        scroll,
        contextGeneration: session.contextGeneration,
        documentGeneration: view.documentGeneration,
        navigationId: view.navigationId,
      },
      summaries: {
        console: {
          total: events.filter(event => event.kind === 'console').length,
          errors: events.filter(event => event.kind === 'console' && event.severity === 'error').length,
        },
        network: {
          total: events.filter(event => event.kind === 'network').length,
          failed: events.filter(event => event.kind === 'network' && (event.failure !== undefined || (event.status !== undefined && event.status >= 400))).length,
        },
        actions: events.filter(event => event.kind === 'action').length,
        performance: { status: 'unavailable' },
      },
      ...(screenshot === undefined ? {} : { artifactManifest: [{ kind: 'screenshot' as const, reference: screenshot }] }),
      page: {
        url: redactUrl(view.page.url()),
        title: (await view.page.title().catch(() => '')).slice(0, 500),
        viewport: { width: view.viewport.width, height: view.viewport.height, generation: view.viewport.generation },
        rootScrollWidth,
      },
      ...(element === undefined ? {} : { element }),
      ...(screenshot === undefined ? {} : { screenshot }),
      l3,
      events,
    })
  }

  protected async scriptSourceMap(session: SessionState, view: ViewState, error: ConsoleJournalEvent) {
    if (error.documentGeneration !== view.documentGeneration || error.navigationId !== view.navigationId) {
      return {
        schemaVersion: 2 as const,
        confidence: 'unavailable' as const,
        errorEventId: error.eventId,
        errorFingerprint: error.fingerprint,
        reason: 'runtime error belongs to a different document or navigation; the current build cannot safely reinterpret it',
      }
    }
    const generated = parseGeneratedLocation(error.stack)
    if (generated === undefined) return { confidence: 'unavailable' as const, reason: 'error stack has no generated script location' }
    const state = await this.ensureDebugger(session, view)
    const selected = this.builds.selectScript(session.key, {
      viewId: view.viewId,
      documentGeneration: error.documentGeneration,
      url: generated.url,
      line: generated.line,
      ...(error.targetId === undefined ? {} : { targetId: error.targetId }),
      ...(error.frameId === undefined ? {} : { frameId: error.frameId }),
    })
    if (selected.status === 'ambiguous') return { confidence: 'unavailable' as const, generated, reason: 'ambiguous-build: more than one active script matches the error identity and generated location' }
    const script = selected.script === undefined ? undefined : state.scripts.get(selected.script.scriptId)
    if (script === undefined) return { confidence: 'unavailable' as const, generated, reason: 'generated script is not available in the current debugger session' }
    const client = rawCdp(state.session)
    const result = await client.send('Debugger.getScriptSource', { scriptId: script.scriptId })
    const source = string(result.scriptSource)
    const sourceMapMatch = /[#@]\s*sourceMappingURL\s*=\s*(\S+)\s*$/m.exec(source)
    const sourceMapReference = sourceMapMatch?.[1]
    if (sourceMapReference === undefined) return { confidence: 'unavailable' as const, generated, reason: 'generated script does not declare sourceMappingURL' }
    let sourceMapUrl: string
    let data: Buffer
    if (sourceMapReference.startsWith('data:')) {
      sourceMapUrl = `${generated.url}#inline-source-map`
      const match = /^data:([^,]*?),(.*)$/s.exec(sourceMapReference)
      if (match === null) return { confidence: 'unavailable' as const, generated, reason: 'inline source map URL is invalid' }
      data = /;base64(?:;|$)/i.test(match[1] ?? '') ? Buffer.from(match[2] ?? '', 'base64') : Buffer.from(decodeURIComponent(match[2] ?? ''))
    } else {
      const allowed = assertUrlAllowed(this.config, new URL(sourceMapReference, script.url).href)
      sourceMapUrl = allowed.href
      const response = await this.sessionContext(session).request.get(allowed.href, { failOnStatusCode: false })
      if (!response.ok()) return { confidence: 'unavailable' as const, generated, sourceMapUrl: redactUrl(sourceMapUrl), reason: `source map request failed with HTTP ${response.status()}` }
      data = await response.body()
    }
    if (data.byteLength > this.config.maxArtifactBytes) {
      return { confidence: 'unavailable' as const, generated, sourceMapUrl: redactUrl(sourceMapUrl), reason: 'source map exceeds the configured artifact size limit' }
    }
    let sourceMap: unknown
    try {
      sourceMap = JSON.parse(data.toString('utf8'))
    } catch {
      return { confidence: 'unavailable' as const, generated, sourceMapUrl: redactUrl(sourceMapUrl), reason: 'source map is not valid JSON' }
    }
    const generatedContentSha256 = createHash('sha256').update(source).digest('hex')
    const build = this.builds.bindSource(session.key, script.scriptId, { source, sourceMapUrl, sourceMap })
    const registered = this.builds.script(session.key, script.scriptId)
    Object.assign(script, {
      buildId: build.buildId,
      ...(registered?.scriptSha256 === undefined ? {} : { scriptSha256: registered.scriptSha256 }),
      ...(registered?.sourceMapSha256 === undefined ? {} : { sourceMapSha256: registered.sourceMapSha256 }),
    })
    const resolution = resolveSourceMap(generated, sourceMapUrl, sourceMap, {
      documentUrl: redactUrl(view.page.url()),
      generatedContentSha256,
      buildId: build.buildId,
    })
    return {
      errorEventId: error.eventId,
      errorFingerprint: error.fingerprint,
      ...resolution,
      ...(resolution.workspace === undefined ? {} : {
        workspaceCandidate: {
          ...resolution.workspace,
          buildId: build.buildId,
          reasons: ['generated location matched one active Script Identity', 'Script content and Source Map hashes matched this Build Identity'],
        },
      }),
      ...(resolution.sourceMapUrl === undefined ? {} : { sourceMapUrl: redactUrl(resolution.sourceMapUrl) }),
    }
  }

  protected async diagnoseAction(session: SessionState, input: BrowserDiagnoseInput): Promise<ToolOutput> {
    if (input.action.startsWith('recorder_')) {
      const action = input.action.slice('recorder_'.length)
      if (action === 'timeline') {
        this.recorder.status(session.sessionId, session.key)
        const timeline = this.recorder.timeline(session.key, input.limit ?? 200)
        return { ok: true, action: 'recorder_timeline', viewId: session.activeViewId, data: asData({ recorder: this.recorder.snapshot(session.key), timeline, inputTraces: this.inputTraces.list(session.key, Math.min(input.limit ?? 100, 200)) }) }
      }
      return this.recorderAction(session, {
        action: action as BrowserRecorderInput['action'],
        ...(input.recorderMode === undefined ? {} : { mode: input.recorderMode }),
        ...(input.incidentId === undefined ? {} : { incidentId: input.incidentId }),
      })
    }
    const lifecycle = await diagnosticLifecycleAction({
      session,
      input,
      debugSessions: this.debugSessions,
      contextIdentities: this.contextIdentities,
      view: (current, viewId) => this.view(current, viewId),
      ensureContextIdentity: (current, view) => this.ensureContextIdentity(current, view),
      refreshApplications: (current, view) => this.refreshApplications(current, view),
      diagnosticContext: (current, view, debugSession) => this.diagnosticContext(current, view, debugSession),
      checkpointCursor: key => this.checkpointCursor(key),
      buildTopology: key => this.builds.snapshot(key),
      applicationTopology: key => ({ truncated: this.applications.snapshot(key).truncated }),
      journalCursor: key => this.journal.cursor(key),
    })
    if (lifecycle !== undefined) return lifecycle
    if (input.action === 'start') {
      const view = this.view(session, input.viewId)
      await this.ensureContextIdentity(session, view)
      const applications = await this.refreshApplications(session, view)
      const existing = this.debugSessions.get(session.key)
      if (existing !== undefined && existing.viewId !== view.viewId) {
        fail('INVALID_ARGS', `browser diagnose session is already bound to view ${existing.viewId}; stop it before starting on another view`)
      }
      if (existing === undefined) {
        session.diagnosticPanel.latestInspect = undefined
        session.diagnosticPanel.latestComparison = undefined
        session.diagnosticPanel.latestIncident = undefined
      }
      const debugSession = this.debugSessions.start({
        sessionKey: session.key,
        dshSessionId: session.sessionId,
        viewId: view.viewId,
        contextGeneration: session.contextGeneration,
        documentGeneration: view.documentGeneration,
        navigationId: view.navigationId,
        ...(view.cdp?.contextAdapter?.isEnabled() ? view.cdp.contextAdapter.mainContext() : {}),
        startedAt: Date.now(),
        startedCursor: this.journal.cursor(session.key),
      })
      return { ok: true, action: 'diagnose_start', viewId: view.viewId, data: asData({ debugSessionId: debugSession.debugSessionId, viewId: view.viewId, contextGeneration: session.contextGeneration, documentGeneration: view.documentGeneration, startedCursor: debugSession.startedCursor, diagnosticContext: this.diagnosticContext(session, view, debugSession), contextTopology: view.cdp?.contextAdapter?.snapshot(), buildTopology: this.builds.snapshot(session.key), applicationTopology: { applications, truncated: this.applications.snapshot(session.key).truncated } }) }
    }
    if (input.action === 'status') {
      const debugSession = this.debugSessions.get(session.key)
      if (debugSession === undefined) {
        return { ok: true, action: 'diagnose_status', viewId: session.activeViewId, data: asData({ active: false, schemaVersion: 2 }) }
      }
      const view = session.views.get(debugSession.viewId)
      if (view === undefined || view.page.isClosed() || debugSession.contextGeneration !== session.contextGeneration) {
        this.debugSessions.invalidate(session.key)
        return { ok: true, action: 'diagnose_status', viewId: session.activeViewId, data: asData({ active: false, schemaVersion: 2, previousDebugSessionId: debugSession.debugSessionId, status: 'invalidated' }) }
      }
      const applications = await this.refreshApplications(session, view)
      return { ok: true, action: 'diagnose_status', viewId: view.viewId, data: asData({ active: true, diagnosticContext: this.diagnosticContext(session, view, debugSession), contextTopology: view.cdp?.contextAdapter?.snapshot(), buildTopology: this.builds.snapshot(session.key), applicationTopology: { applications, truncated: this.applications.snapshot(session.key).truncated }, startedAt: debugSession.startedAt, startedCursor: debugSession.startedCursor, checkpointCount: debugSession.checkpoints.size, cursor: this.journal.cursor(session.key) }) }
    }
    if (input.action === 'stop') {
      const stopped = this.debugSessions.stop(session.key)
      if (stopped !== undefined) {
        const state = session.views.get(stopped.viewId)?.cdp
        state?.contextAdapter?.dispose()
        if (state !== undefined) state.contextAdapter = undefined
        this.contextIdentities.invalidateSession(session.key, session.contextGeneration)
      }
      return { ok: true, action: 'diagnose_stop', viewId: stopped?.viewId ?? session.activeViewId, data: asData({
        stopped: stopped !== undefined,
        schemaVersion: 2,
        cleanup: {
          status: 'clean',
          debugSessionStore: 'clean',
          checkpointStore: 'clean',
          journal: 'retained-by-browser-session',
          browserResources: 'managed-by-runtime',
        },
        ...(stopped === undefined ? {} : { debugSessionId: stopped.debugSessionId, status: stopped.status, cursor: this.journal.cursor(session.key) }),
      }) }
    }
    const { record: debugSession, view } = this.debugSessionView(session, input)
    if (input.action === 'inspect') {
      const ref = input.ref?.trim()
      if (ref === undefined || ref === '') fail('INVALID_ARGS', 'browser_diagnose inspect requires a current snapshot ref')
      const element = await this.inspectElement(view, ref)
      const application = await this.elementApplication(session, view, ref)
      if (application !== undefined) element.application = application
      const occluder = element.hitTest?.targetMatches === false ? element.hitTest.topElement : undefined
      session.diagnosticPanel.latestInspect = {
        viewId: view.viewId,
        documentGeneration: view.documentGeneration,
        navigationId: view.navigationId,
        ref,
        target: {
          tag: element.identity?.tag ?? 'unknown',
          ...(element.identity?.role === undefined ? {} : { role: element.identity.role }),
          ...(element.identity?.accessibleName === undefined ? {} : { accessibleName: element.identity.accessibleName }),
          ...(element.box === undefined ? {} : { box: element.box }),
        },
        ...(occluder === undefined || occluder === null ? {} : {
          occluder: {
            tag: occluder.tag,
            ...(occluder.id === undefined ? {} : { id: occluder.id }),
            ...(occluder.role === undefined ? {} : { role: occluder.role }),
            ...(occluder.accessibleName === undefined ? {} : { accessibleName: occluder.accessibleName }),
            box: occluder.box,
          },
        }),
      }
      const { events, range } = this.diagnosticRange(session, view, input, this.checkpointCursor(session.key))
      return { ok: true, action: 'diagnose_inspect', viewId: view.viewId, data: asData({ debugSessionId: debugSession.debugSessionId, contextGeneration: session.contextGeneration, documentGeneration: view.documentGeneration, navigationId: view.navigationId, diagnosticContext: this.diagnosticContext(session, view, debugSession), range, element, evidence: projectEvidence(events), actionTimeline: projectActionTimeline(events) }) }
    }
    if (input.action === 'checkpoint') {
      const checkpoint = await this.diagnosticCheckpoint(session, input)
      return { ok: true, action: 'diagnose_checkpoint', viewId: view.viewId, data: asData({ diagnosticContext: this.diagnosticContext(session, view, debugSession), checkpoint }) }
    }
    if (input.action === 'compare') {
      const beforeId = input.beforeCheckpointId?.trim()
      const afterId = input.afterCheckpointId?.trim()
      if (beforeId === undefined || beforeId === '' || afterId === undefined || afterId === '') fail('INVALID_ARGS', 'browser_diagnose compare requires beforeCheckpointId and afterCheckpointId')
      const before = this.debugSessions.checkpointById(session.key, beforeId)
      const after = this.debugSessions.checkpointById(session.key, afterId)
      if (before === undefined || after === undefined) fail('INVALID_ARGS', 'browser diagnose checkpoint does not exist in the current session')
      const comparison = compareCheckpoints(before, after)
      const l3Comparison = before.l3 === undefined || after.l3 === undefined ? undefined : compareL3Checkpoints(before.l3, after.l3)
      session.diagnosticPanel.latestComparison = {
        beforeCheckpointId: comparison.before,
        afterCheckpointId: comparison.after,
        overallVerdict: comparison.overallVerdict,
        comparable: comparison.comparability.comparable,
        newRegressionCount: comparison.newRegressions.errors.length
          + comparison.newRegressions.failedRequests.length
          + Number(comparison.newRegressions.elementOccluded)
          + Number(comparison.newRegressions.rootOverflowIncreased),
        ...(l3Comparison === undefined ? {} : { l3Verdict: l3Comparison.verdict, l3Comparable: l3Comparison.comparability.comparable }),
      }
      const output = projectDiagnosticCompareOutput({
        comparison,
        ...(l3Comparison === undefined ? {} : { l3Comparison }),
        diagnosticContext: this.diagnosticContext(session, view, debugSession),
      })
      return { ok: true, action: 'diagnose_compare', viewId: view.viewId, data: asData(output) }
    }
    if (input.action === 'report') {
      const applications = await this.refreshApplications(session, view)
      const { events, range } = this.diagnosticRange(session, view, input, debugSession.startedCursor.sequence)
      const errors = events.filter((event): event is ConsoleJournalEvent => event.kind === 'console' && event.stack !== undefined).slice(-10)
      const sourceMaps = []
      for (const error of errors) sourceMaps.push(await this.scriptSourceMap(session, view, error))
      const checkpoints = this.debugSessions.checkpoints(session.key)
      const before = checkpoints.at(-2)
      const after = checkpoints.at(-1)
      const comparison = before === undefined || after === undefined ? undefined : compareCheckpoints(before, after)
      const l3Comparison = before?.l3 === undefined || after?.l3 === undefined ? undefined : compareL3Checkpoints(before.l3, after.l3)
      const environment = {
        provider: session.provider,
        viewId: view.viewId,
        contextGeneration: session.contextGeneration,
        documentGeneration: view.documentGeneration,
        navigationId: view.navigationId,
        url: redactUrl(view.page.url()),
      }
      const timeline = projectActionTimeline(events)
      const incidentReport = buildIncidentReport({
        debugSession,
        events,
        timeline,
        checkpoints,
        sourceMappings: sourceMaps,
        ...(comparison === undefined ? {} : { comparison }),
        environment,
        generatedAt: Date.now(),
      })
      const selectedL3 = checkpoints.at(-1)?.l3
      const currentContextTopology = view.cdp?.contextAdapter?.isEnabled() ? view.cdp.contextAdapter.snapshot() : undefined
      const currentControllerIdentity = this.controllerIdentity(session.sessionId)
      const currentL3 = createL3Checkpoint({
        ...(currentControllerIdentity === undefined ? {} : { controllerIdentity: currentControllerIdentity }),
        ...(currentContextTopology === undefined ? {} : { contextTopology: currentContextTopology }),
        recorder: this.recorder.status(session.sessionId, session.key),
        builds: this.builds.snapshot(session.key).builds,
        applications,
        ...(selectedL3?.selectedApplicationId === undefined ? {} : { selectedApplicationId: selectedL3.selectedApplicationId }),
        ...(selectedL3?.surface === undefined ? {} : { surface: selectedL3.surface }),
        degradations: currentContextTopology?.degradations.map(item => item.code) ?? [],
      })
      const crossContextLinks = buildCrossContextLinks({
        checkpointId: checkpoints.at(-1)?.checkpointId ?? 'current',
        snapshot: currentL3,
        actionIds: timeline.map(item => item.actionId),
        errorEventIds: errors.map(item => item.eventId),
      })
      const l3Incident = {
        l3IncidentSchemaVersion: 1 as const,
        ...(currentL3.controllerIdentity === undefined ? {} : { controllerIdentity: currentL3.controllerIdentity }),
        ...(currentL3.contextTopology === undefined ? {} : { context: currentL3.contextTopology }),
        recorder: currentL3.recorder,
        applications: currentL3.applications,
        builds: currentL3.builds,
        ...(currentL3.surface === undefined ? {} : { surface: currentL3.surface }),
        ...(l3Comparison === undefined ? {} : { comparison: l3Comparison }),
        crossContextLinks,
        degradations: currentL3.degradations,
        uncertainty: [
          ...(currentL3.contextTopology === undefined ? ['Context Topology is unavailable.'] : []),
          ...(currentL3.applications.some(item => item.confidence === 'candidate') ? ['Some Application identities remain candidates.'] : []),
          ...(sourceMaps.some(mapping => mapping.confidence === 'unavailable') ? ['Some source mappings remain unavailable.'] : []),
        ],
      }
      session.diagnosticPanel.latestIncident = {
        incidentId: incidentReport.incident.incidentId,
        generatedAt: incidentReport.incident.generatedAt,
        factCount: incidentReport.incident.facts.length,
        causalCandidateCount: incidentReport.incident.causalCandidates.length,
        verificationStatus: incidentReport.incident.verification.status,
        reportBytes: incidentReport.incident.costs.reportBytes,
        crossContextLinkCount: crossContextLinks.length,
        ...(l3Comparison === undefined ? {} : { l3Verdict: l3Comparison.verdict }),
      }
      const markdownTruncated = incidentReport.markdown.length > this.config.maxOutputChars
      const markdown = markdownTruncated
        ? `${incidentReport.markdown.slice(0, this.config.maxOutputChars)}\n\n[TRUNCATED: read the bounded Incident JSON and Artifact Manifest for complete references.]`
        : incidentReport.markdown
      return {
        ok: true,
        action: 'diagnose_report',
        viewId: view.viewId,
        data: asData({
          debugSessionId: debugSession.debugSessionId,
          diagnosticContext: this.diagnosticContext(session, view, debugSession),
          range,
          environment: {
            ...environment,
            viewportGeneration: view.viewport.generation,
          },
          evidence: projectEvidence(events),
          correlations: projectCorrelations(events),
          actionTimeline: timeline,
          checkpoints: checkpoints.map(checkpoint => ({
            checkpointId: checkpoint.checkpointId,
            label: checkpoint.label,
            createdAt: checkpoint.createdAt,
            viewId: checkpoint.viewId,
            contextGeneration: checkpoint.contextGeneration,
            documentGeneration: checkpoint.documentGeneration,
            navigationId: checkpoint.navigationId,
            page: checkpoint.page,
            ...(checkpoint.element === undefined ? {} : { element: checkpoint.element }),
            ...(checkpoint.screenshot === undefined ? {} : { screenshot: checkpoint.screenshot }),
          })),
          sourceMaps,
          buildTopology: this.builds.snapshot(session.key),
          applicationTopology: { applications, truncated: this.applications.snapshot(session.key).truncated },
          incident: incidentReport.incident,
          l3Incident,
          crossContextLinks,
          markdown,
          markdownTruncated,
          artifactManifest: incidentReport.artifactManifest,
          uncertainty: [
            ...(sourceMaps.some(mapping => mapping.confidence === 'unavailable') ? ['Some runtime errors could not be mapped to original source.'] : []),
            ...(events.some(event => event.documentGeneration !== view.documentGeneration) ? ['The report spans more than one document generation; cross-document evidence is not marked as confirmed causality.'] : []),
          ],
        }),
      }
    }
    fail('INVALID_ARGS', `unknown browser_diagnose action ${JSON.stringify(input.action)}`)
  }
}
