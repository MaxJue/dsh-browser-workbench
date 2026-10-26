import { fail } from '../domain/errors.ts'
import type { BrowserRecorderInput } from '../domain/protocol.ts'
import type { SessionState, ToolOutput } from '../domain/types.ts'
import { BrowserRuntimeViewServices } from './runtime-view-services.ts'

function asData(value: unknown): ToolOutput['data'] {
  return value as ToolOutput['data']
}

export class BrowserRuntimeInteractionServices extends BrowserRuntimeViewServices {
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
