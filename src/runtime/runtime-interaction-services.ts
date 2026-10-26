import { fail } from '../domain/errors.ts'
import type {
  BrowserRecorderInput,
  BrowserTakeoverInput,
  BrowserUserInput,
} from '../domain/protocol.ts'
import type { SessionState, ToolOutput, ViewState } from '../domain/types.ts'
import { inputSensitivity, type InputTraceRecord } from '../diagnostics/input-trace.ts'
import { inputTraceAction } from '../input/input-actions.ts'
import {
  beginInputObservation as beginInputObservationModule,
  finishInputObservation as finishInputObservationModule,
} from '../input/input-observation.ts'
import { dispatchUserInput } from '../input/user-input-actions.ts'
import { BrowserRuntimeViewServices } from './runtime-view-services.ts'

function asData(value: unknown): ToolOutput['data'] {
  return value as ToolOutput['data']
}

export class BrowserRuntimeInteractionServices extends BrowserRuntimeViewServices {
  protected finishPanelTakeover(session: SessionState, view: ViewState): void {
    const takeover = session.diagnosticPanel.takeover
    if (takeover === undefined) return
    const events = this.journal.events(session.key, takeover.startedSequence, takeover.viewId)
    const actions = events.filter(event => event.kind === 'action' && event.humanInitiated)
    session.diagnosticPanel.latestTakeoverSummary = {
      startedAt: takeover.startedAt,
      finishedAt: Date.now(),
      actionCount: actions.length,
      documentChanged: takeover.documentGeneration !== view.documentGeneration,
      navigationChanged: takeover.navigationId !== view.navigationId,
      newConsoleErrors: events.filter(event => event.kind === 'console' && event.severity === 'error').length,
      newFailedRequests: events.filter(event => event.kind === 'network' && (event.failure !== undefined || (event.status !== undefined && event.status >= 400))).length,
    }
    session.diagnosticPanel.takeover = undefined
  }

  protected async takeoverAction(session: SessionState, input: BrowserTakeoverInput): Promise<ToolOutput> {
    const view = this.view(session, input.viewId)
    if (input.action === 'request') {
      if (session.control.owner !== 'user') {
        session.diagnosticPanel.takeover = {
          startedAt: Date.now(),
          startedSequence: this.journal.cursor(session.key).sequence,
          viewId: view.viewId,
          documentGeneration: view.documentGeneration,
          navigationId: view.navigationId,
        }
      }
      session.control.owner = 'user'
      session.control.pending = false
      session.control.changedAt = Date.now()
    } else if (input.action === 'return') {
      this.finishPanelTakeover(session, view)
      session.control.owner = 'model'
      session.control.pending = false
      session.control.changedAt = Date.now()
    } else if (input.action === 'cancel') {
      session.control.pending = false
      session.control.changedAt = Date.now()
    } else if (input.action !== 'status') {
      fail('INVALID_ARGS', `unknown browser_takeover action ${JSON.stringify(input.action)}`)
    }
    return { ok: true, action: 'takeover', viewId: view.viewId, data: asData(session.control) }
  }

  protected async userInputAction(session: SessionState, input: BrowserUserInput): Promise<ToolOutput> {
    if (!this.visibleViewIds(session).has(input.viewId)) {
      return { ok: false, action: 'user_input', viewId: input.viewId, data: asData({ code: 'STALE_LIVE_VIEW', recoverable: true, message: 'The active browser view changed before the user input was delivered. Wait for the newest frame and try again.' }) }
    }
    const view = this.view(session, input.viewId)
    const pane = this.splitPaneForView(session, view.viewId)
    if (pane !== undefined) {
      session.splitView.focusedPane = pane
      session.activeViewId = view.viewId
    }
    const popupInput = session.extensionPopup?.view.viewId === input.viewId
    if (session.control.owner !== 'user' && !popupInput) {
      fail('POLICY_DENIED', 'browser user input requires active user takeover')
    }
    const state = await this.cdp(session, view)
    return dispatchUserInput({ session, view, state, input })
  }

  protected inputTraceAction(input: BrowserUserInput): InputTraceRecord['action'] {
    return inputTraceAction(input)
  }

  protected async beginInputObservation(view: ViewState, inputTraceId: string): Promise<{
    sensitivity: ReturnType<typeof inputSensitivity>
    initialLength: number
  }> {
    return beginInputObservationModule(view, inputTraceId)
  }

  protected async finishInputObservation(view: ViewState, inputTraceId: string): Promise<{
    observed: boolean
    composing: boolean
    prevented: boolean
    beforeInputObserved: boolean
    compositionStarted: boolean
    compositionUpdated: boolean
    compositionEnded: boolean
    events: Array<{ type: string; composing: boolean; defaultPrevented: boolean; inputType: string; length: number }>
    targetReplaced: boolean
    focusLost: boolean
    initialLength: number
    finalLength: number
  }> {
    return finishInputObservationModule(view, inputTraceId)
  }

  protected async recorderAction(session: SessionState, input: BrowserRecorderInput): Promise<ToolOutput> {
    if (input.action === 'status') {
      return { ok: true, action: 'recorder_status', viewId: session.activeViewId, data: asData({ ...this.recorder.status(session.sessionId, session.key), visualCapture: this.visualCaptureState(session) }) }
    }
    if (input.action === 'start') {
      const mode = input.mode ?? 'rolling'
      const snapshot = this.recorder.setMode(session.sessionId, session.key, mode)
      await this.syncScreencasts(session)
      return { ok: true, action: 'recorder_start', viewId: session.activeViewId, data: asData(snapshot) }
    }
    if (input.action === 'pause') {
      const snapshot = this.recorder.pause(session.key)
      await this.syncScreencasts(session)
      return { ok: true, action: 'recorder_pause', viewId: session.activeViewId, data: asData(snapshot) }
    }
    if (input.action === 'resume') {
      const snapshot = this.recorder.resume(session.key)
      await this.syncScreencasts(session)
      return { ok: true, action: 'recorder_resume', viewId: session.activeViewId, data: asData(snapshot) }
    }
    if (input.action === 'clear') {
      this.recorder.clearSession(session.key, true)
      this.inputTraces.clearSession(session.key)
      return { ok: true, action: 'recorder_clear', viewId: session.activeViewId, data: asData(this.recorder.status(session.sessionId, session.key)) }
    }
    if (input.action === 'stop') {
      const snapshot = this.recorder.setMode(session.sessionId, session.key, 'off')
      await this.syncScreencasts(session)
      return { ok: true, action: 'recorder_stop', viewId: session.activeViewId, data: asData(snapshot) }
    }
    if (input.action === 'mark') {
      const incident = this.recorder.mark(session.key)
      return { ok: true, action: 'recorder_mark', viewId: session.activeViewId, data: asData({ incident, recorder: this.recorder.snapshot(session.key) }) }
    }
    if (input.action === 'complete') {
      if (input.incidentId === undefined || input.incidentId.trim() === '') fail('INVALID_ARGS', 'recorder complete requires incidentId')
      const incident = this.recorder.complete(session.key, input.incidentId)
      return { ok: true, action: 'recorder_complete', viewId: session.activeViewId, data: asData({ incident, recorder: this.recorder.snapshot(session.key) }) }
    }
    fail('INVALID_ARGS', `unknown browser recorder action ${JSON.stringify(input.action)}`)
  }
}

