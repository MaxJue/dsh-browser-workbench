import { basename } from 'node:path'
import { fail } from '../domain/errors.ts'
import { assertUrlAllowed, redactUrl } from '../domain/policy.ts'
import type {
  BrowserDebuggerInput,
  BrowserEmulateInput,
  BrowserLiveViewInput,
  BrowserSplitViewInput,
  BrowserSplitViewPane,
} from '../domain/protocol.ts'
import type { SessionState, ToolOutput, ViewState } from '../domain/types.ts'
import { rawCdp, record, string } from '../cdp/cdp-raw.ts'
import { emulateBrowser } from '../provider/emulation-actions.ts'
import { applyAdaptiveFit as applyAdaptiveFitModule, clearAdaptiveFit as clearAdaptiveFitModule } from '../view/adaptive-viewport.ts'
import { mutateLiveViewState } from '../view/live-view-actions.ts'
import { liveViewState as projectLiveViewState } from '../view/live-view-state.ts'
import { applyLiveViewport as applyLiveViewportModule, applyVisibleLiveViewports as applyVisibleLiveViewportsModule } from '../view/live-viewport.ts'
import { liveViewport, splitPaneForView, splitPaneView, splitSnapshot, visibleViewIds } from '../view/view-layout.ts'
import {
  forceStopScreencast as stopScreencast,
  releaseScreencast as releaseScreencastConsumer,
  restartScreencast as restartScreencastStream,
  startScreencast,
} from '../view/screencast.ts'
import { syncScreencasts as syncScreencastsModule } from '../view/screencast-sync.ts'
import { mutateSplitView } from '../view/split-view-actions.ts'
import { BrowserRuntimeFoundation } from './runtime-core-foundation.ts'
import { debuggerState, visualCaptureState } from './runtime-projections.ts'

function asData(value: unknown): ToolOutput['data'] {
  return value as ToolOutput['data']
}

export class BrowserRuntimeViewServices extends BrowserRuntimeFoundation {
  protected liveViewport(session: SessionState): { width: number; height: number } {
    return liveViewport(session)
  }

  protected splitPaneView(session: SessionState, pane: BrowserSplitViewPane): ViewState | undefined {
    return splitPaneView(session, pane)
  }

  protected visibleViewIds(session: SessionState): Set<string> {
    return visibleViewIds(session)
  }

  protected splitPaneForView(session: SessionState, viewId: string): BrowserSplitViewPane | undefined {
    return splitPaneForView(session, viewId)
  }

  protected async syncScreencasts(session: SessionState): Promise<void> {
    await syncScreencastsModule(session, session.views.values(), {
      visibleViewIds: target => this.visibleViewIds(target),
      recorderStatus: target => this.recorder.status(target.sessionId, target.key),
      ensureScreencast: (target, view, consumer) => this.ensureScreencast(target, view, consumer),
      releaseScreencast: (view, consumer) => this.releaseScreencast(view, consumer),
    })
  }

  protected splitSnapshot(session: SessionState) {
    return splitSnapshot(session)
  }

  protected async splitViewAction(session: SessionState, input: BrowserSplitViewInput): Promise<ToolOutput> {
    const result = await mutateSplitView(session, input, {
      createPage: target => this.createPage(target),
      bindView: (target, page) => this.bindView(target, page),
      splitPaneView: (target, pane) => this.splitPaneView(target, pane),
      resolveView: (target, viewId) => this.view(target, viewId),
      savePreference: (sessionId, preference) => this.profiles.saveSplitViewPreference(sessionId, preference),
      applyLiveViewport: (target, view) => this.applyLiveViewport(target, view),
    })
    if (result.status) return { ok: true, action: 'split_view', viewId: result.viewId, data: asData({ ...this.splitSnapshot(session), changed: false }) }
    if (result.noActive) return { ok: false, action: 'split_view', data: asData({ code: 'NO_ACTIVE_TAB', recoverable: true, message: 'Split view requires at least one browser tab.' }) }
    await this.syncScreencasts(session)
    return { ok: true, action: 'split_view', viewId: session.activeViewId, data: asData({ ...this.splitSnapshot(session), changed: result.changed }) }
  }

  protected async setViewViewport(session: SessionState, view: ViewState, width: number, height: number): Promise<void> {
    if (view.viewport.width === width && view.viewport.height === height) return
    const state = await this.cdp(session, view)
    await rawCdp(state.session).send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: view.viewport.deviceScaleFactor, mobile: view.viewport.mobile })
    view.viewport.width = width
    view.viewport.height = height
    view.viewport.generation += 1
    state.latestFrame = undefined
  }

  protected async clearAdaptiveFit(view: ViewState): Promise<void> {
    await clearAdaptiveFitModule(view)
  }

  protected async applyAdaptiveFit(session: SessionState, view: ViewState): Promise<void> {
    await applyAdaptiveFitModule(session, view, current => this.restartScreencast(session, current))
  }

  protected async applyLiveViewport(session: SessionState, view: ViewState): Promise<void> {
    await applyLiveViewportModule(session, view, this.liveViewportDependencies())
  }

  protected async applyVisibleLiveViewports(session: SessionState): Promise<void> {
    await applyVisibleLiveViewportsModule(session, this.visibleViewIds(session), session.views, this.liveViewportDependencies())
  }

  protected liveViewportDependencies() {
    return {
      splitPaneForView: (target: SessionState, viewId: string) => this.splitPaneForView(target, viewId),
      liveViewport: (target: SessionState) => this.liveViewport(target),
      setViewViewport: (target: SessionState, current: ViewState, width: number, height: number) => this.setViewViewport(target, current, width, height),
      applyAdaptiveFit: (target: SessionState, current: ViewState) => this.applyAdaptiveFit(target, current),
      clearAdaptiveFit: (current: ViewState) => this.clearAdaptiveFit(current),
    }
  }

  protected liveViewState(session: SessionState, view: ViewState) {
    return projectLiveViewState(session, view)
  }

  protected async liveViewAction(session: SessionState, input: BrowserLiveViewInput, actor: 'model' | 'user' = 'model'): Promise<ToolOutput> {
    const view = this.view(session, input.viewId)
    if (input.action === 'status') return { ok: true, action: 'live_view', viewId: view.viewId, data: asData({ ...this.liveViewState(session, view), changed: false }) }
    if (actor === 'model' && (input.action === 'standard' || input.action === 'adaptive')) {
      const blocked = this.modelWriteBlocked(session, view, 'live_view')
      if (blocked !== undefined) return blocked
    }
    const previousMode = session.liveView.mode
    const previousWidth = view.viewport.width
    const previousHeight = view.viewport.height
    const mutation = mutateLiveViewState(session, input)
    if (mutation.adaptiveUnavailable) {
      return { ok: false, action: 'live_view', viewId: view.viewId, data: asData({ code: 'ADAPTIVE_SIZE_UNAVAILABLE', recoverable: true, message: 'Adaptive mode requires an open live panel to report its available size.', next: { tool: 'browser_live_view', arguments: { action: 'standard', viewId: view.viewId } } }) }
    }
    if (mutation.mutation === 'initialize') {
      await this.applyVisibleLiveViewports(session)
      return { ok: true, action: 'live_view', viewId: view.viewId, data: asData({ ...this.liveViewState(session, view), changed: false }) }
    }
    if (mutation.mutation === 'resize') {
      if (mutation.changed && session.liveView.mode === 'adaptive') await this.applyVisibleLiveViewports(session)
      return { ok: true, action: 'live_view', viewId: view.viewId, data: asData({ ...this.liveViewState(session, view), changed: mutation.changed }) }
    }
    await this.applyVisibleLiveViewports(session)
    const changed = previousMode !== session.liveView.mode || previousWidth !== view.viewport.width || previousHeight !== view.viewport.height
    return { ok: true, action: 'live_view', viewId: view.viewId, data: asData({ ...this.liveViewState(session, view), changed }) }
  }

  protected async emulateAction(session: SessionState, input: BrowserEmulateInput, actor: 'model' | 'user' = 'model'): Promise<ToolOutput> {
    const view = this.view(session, input.viewId)
    if (actor === 'model') {
      const blocked = this.modelWriteBlocked(session, view, 'emulate')
      if (blocked !== undefined) return blocked
    }
    const state = await this.cdp(session, view)
    return emulateBrowser(input, {
      session,
      view,
      state,
      clearAdaptiveFit: current => this.clearAdaptiveFit(current),
      grantPermissions: (permissions, origin) => this.sessionContext(session).grantPermissions(permissions, origin === undefined ? undefined : { origin }),
      clearPermissions: () => this.sessionContext(session).clearPermissions(),
    })
  }

  protected async ensureDebugger(session: SessionState, view: ViewState) {
    const state = await this.cdp(session, view)
    if (!state.debuggerEnabled) {
      const client = rawCdp(state.session)
      await client.send('Runtime.enable')
      await client.send('Debugger.enable')
      state.debuggerEnabled = true
    }
    return state
  }

  protected async ensureScreencast(session: SessionState, view: ViewState, consumer: 'live-view' | 'recorder'): Promise<void> {
    await this.cdp(session, view)
    await startScreencast(view, consumer)
  }

  protected async releaseScreencast(view: ViewState, consumer: 'live-view' | 'recorder'): Promise<void> {
    await releaseScreencastConsumer(view, consumer)
  }

  protected async restartScreencast(session: SessionState, view: ViewState): Promise<void> {
    await this.cdp(session, view)
    await restartScreencastStream(view)
  }

  protected async forceStopScreencast(view: ViewState): Promise<void> {
    await stopScreencast(view)
  }

  protected debuggerState(view: ViewState) {
    return debuggerState(view)
  }

  protected visualCaptureState(session: SessionState) {
    return visualCaptureState(session)
  }

  protected async debuggerAction(session: SessionState, input: BrowserDebuggerInput, actor: 'model' | 'user' = 'model'): Promise<ToolOutput> {
    const view = this.view(session, input.viewId)
    if (actor === 'model' && /^(detach|pause|resume|step_over|step_into|step_out|set_breakpoint|remove_breakpoint)$/.test(input.action)) {
      const blocked = this.modelWriteBlocked(session, view, 'debugger')
      if (blocked !== undefined) return blocked
    }
    if (input.action === 'attach') {
      await this.ensureDebugger(session, view)
    } else if (input.action === 'detach') {
      const state = view.cdp
      if (state !== undefined) {
        state.contextAdapter?.dispose()
        this.contextIdentities.invalidateSession(session.key, session.contextGeneration)
        await this.forceStopScreencast(view)
        await rawCdp(state.session).detach().catch(() => {})
        view.cdp = undefined
        if (this.debugSessions.get(session.key)?.viewId === view.viewId) this.debugSessions.invalidate(session.key)
        view.viewport.generation += 1
        await this.syncScreencasts(session)
      }
    } else {
      const state = await this.ensureDebugger(session, view)
      const client = rawCdp(state.session)
      if (input.action === 'pause') await client.send('Debugger.pause')
      else if (/^(resume|step_over|step_into|step_out)$/.test(input.action) && !state.paused) {
        return { ok: false, action: 'debugger', viewId: view.viewId, data: asData({ code: 'DEBUGGER_NOT_PAUSED', recoverable: true, message: 'The page is not paused.', next: { tool: 'browser_debugger', arguments: { action: 'pause', viewId: view.viewId } } }) }
      } else if (input.action === 'resume') await client.send('Debugger.resume')
      else if (input.action === 'step_over') await client.send('Debugger.stepOver')
      else if (input.action === 'step_into') await client.send('Debugger.stepInto')
      else if (input.action === 'step_out') await client.send('Debugger.stepOut')
      else if (input.action === 'set_breakpoint') {
        if (input.url === undefined || input.lineNumber === undefined) fail('INVALID_ARGS', 'set_breakpoint requires url and lineNumber')
        const result = await client.send('Debugger.setBreakpointByUrl', { url: input.url, lineNumber: input.lineNumber, columnNumber: input.columnNumber ?? 0 })
        const breakpointId = string(result.breakpointId)
        state.breakpoints.set(breakpointId, { breakpointId, url: input.url, lineNumber: input.lineNumber, columnNumber: input.columnNumber ?? 0 })
      } else if (input.action === 'remove_breakpoint') {
        if (input.breakpointId === undefined) fail('INVALID_ARGS', 'remove_breakpoint requires breakpointId')
        await client.send('Debugger.removeBreakpoint', { breakpointId: input.breakpointId })
        state.breakpoints.delete(input.breakpointId)
      } else if (input.action === 'scope_variables') {
        if (input.callFrameId === undefined || input.scopeNumber === undefined) fail('INVALID_ARGS', 'scope_variables requires callFrameId and scopeNumber')
        const frame = state.callFrames.find(item => item.callFrameId === input.callFrameId)
        const objectId = frame?.scopes[input.scopeNumber]?.objectId
        if (objectId === undefined) return { ok: false, action: 'scope_variables', viewId: view.viewId, data: asData({ code: 'UNKNOWN_SCOPE', recoverable: true, message: 'The requested scope is no longer available.', next: { tool: 'browser_debugger', arguments: { action: 'call_frames', viewId: view.viewId } } }) }
        const result = await client.send('Runtime.getProperties', { objectId, ownProperties: true, generatePreview: true })
        const properties = (Array.isArray(result.result) ? result.result : []).map(value => {
          const property = record(value)
          const remote = record(property.value)
          const name = string(property.name)
          const sensitive = /token|secret|password|cookie|authorization/i.test(name)
          return { name, value: sensitive ? '[REDACTED]' : remote.value ?? remote.description ?? remote.type ?? null }
        })
        return { ok: true, action: 'scope_variables', viewId: view.viewId, data: asData({ properties }) }
      } else if (input.action === 'script_source' || input.action === 'source_map') {
        if (input.scriptId === undefined) fail('INVALID_ARGS', `${input.action} requires scriptId`)
        const script = state.scripts.get(input.scriptId)
        if (script === undefined) return { ok: false, action: 'script_source', viewId: view.viewId, data: asData({ code: 'UNKNOWN_SCRIPT', recoverable: true, message: 'The script is no longer available.', next: { tool: 'browser_debugger', arguments: { action: 'scripts', viewId: view.viewId } } }) }
        const result = await client.send('Debugger.getScriptSource', { scriptId: input.scriptId })
        const source = string(result.scriptSource)
        const sourceMapMatch = /[#@]\s*sourceMappingURL\s*=\s*(\S+)\s*$/m.exec(source)
        const sourceMapUrl = sourceMapMatch?.[1]
        if (input.action === 'source_map') {
          if (sourceMapUrl === undefined) return { ok: false, action: 'source_map', viewId: view.viewId, data: asData({ code: 'SOURCE_MAP_NOT_DECLARED', recoverable: false, message: 'The script does not declare sourceMappingURL.' }) }
          let data: Buffer
          let name = `source-map-${input.scriptId}.map`
          if (sourceMapUrl.startsWith('data:')) {
            const match = /^data:([^,]*?),(.*)$/s.exec(sourceMapUrl)
            if (match === null) fail('PROFILE_FAILED', 'source map data URL is invalid')
            data = /;base64(?:;|$)/i.test(match[1] ?? '') ? Buffer.from(match[2] ?? '', 'base64') : Buffer.from(decodeURIComponent(match[2] ?? ''))
          } else {
            if (script.url === '') fail('PROFILE_FAILED', 'relative source map cannot be resolved for an anonymous script')
            const url = assertUrlAllowed(this.config, new URL(sourceMapUrl, script.url).href)
            const response = await this.sessionContext(session).request.get(url.href, { failOnStatusCode: false })
            if (!response.ok()) fail('PROFILE_FAILED', `source map request failed with HTTP ${response.status()}`)
            data = await response.body()
            name = basename(url.pathname) || name
          }
          const artifact = await this.artifacts.save(session.key, 'source-map', name, data)
          state.profile.artifacts.push(artifact)
          let sourceMap: unknown
          try {
            sourceMap = JSON.parse(data.toString('utf8'))
          } catch {
            sourceMap = undefined
          }
          const resolvedSourceMapUrl = sourceMapUrl.startsWith('data:') ? `${script.url}#inline-source-map` : new URL(sourceMapUrl, script.url).href
          const build = this.builds.bindSource(session.key, input.scriptId, { source, sourceMapUrl: resolvedSourceMapUrl, ...(sourceMap === undefined ? {} : { sourceMap }) })
          const registered = this.builds.script(session.key, input.scriptId)
          Object.assign(script, {
            buildId: build.buildId,
            ...(registered?.scriptSha256 === undefined ? {} : { scriptSha256: registered.scriptSha256 }),
            ...(registered?.sourceMapSha256 === undefined ? {} : { sourceMapSha256: registered.sourceMapSha256 }),
          })
          return { ok: true, action: 'source_map', viewId: view.viewId, data: asData({ script, build, artifact }) }
        }
        const build = this.builds.bindSource(session.key, input.scriptId, { source, ...(sourceMapUrl === undefined ? {} : { sourceMapUrl: sourceMapUrl.startsWith('data:') ? `${script.url}#inline-source-map` : new URL(sourceMapUrl, script.url).href }) })
        const registered = this.builds.script(session.key, input.scriptId)
        Object.assign(script, { buildId: build.buildId, ...(registered?.scriptSha256 === undefined ? {} : { scriptSha256: registered.scriptSha256 }) })
        const sourceMapReference = sourceMapUrl === undefined
          ? {}
          : sourceMapUrl.startsWith('data:')
            ? { sourceMapUrl: '[INLINE_DATA_URL]' }
            : script.url === ''
              ? { sourceMapUrl: sourceMapUrl.slice(0, 500) }
              : { sourceMapUrl: redactUrl(new URL(sourceMapUrl, script.url).href) }
        if (Buffer.byteLength(source) > this.config.maxOutputChars) {
          const artifact = await this.artifacts.save(session.key, 'script-source', `script-${input.scriptId}.js`, source)
          state.profile.artifacts.push(artifact)
          return { ok: true, action: 'script_source', viewId: view.viewId, data: asData({ script, build, bytes: Buffer.byteLength(source), artifact, ...sourceMapReference }) }
        }
        return { ok: true, action: 'script_source', viewId: view.viewId, data: asData({ script, build, bytes: Buffer.byteLength(source), source, ...sourceMapReference }) }
      } else if (input.action !== 'call_frames' && input.action !== 'scripts') {
        fail('INVALID_ARGS', `unknown browser_debugger action ${JSON.stringify(input.action)}`)
      }
    }
    return { ok: true, action: 'debugger', viewId: view.viewId, data: asData(this.debuggerState(view)) }
  }
}

