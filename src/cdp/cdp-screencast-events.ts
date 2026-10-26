import type { SessionState, ViewState } from '../domain/types.ts'
import type { CdpState } from './cdp-state.ts'
import { number, record, string, type RawCdpSession } from './cdp-raw.ts'

export interface CdpScreencastDependencies {
  recorderStatus: (session: SessionState) => { mode: string; status: string }
  recordVisualFrame: (session: SessionState, view: ViewState, state: CdpState, metadata: Record<string, unknown>) => void
}

export function bindCdpScreencastEvents(client: RawCdpSession, state: CdpState, session: SessionState, view: ViewState, dependencies: CdpScreencastDependencies): void {
  client.on('Page.screencastFrame', payload => {
    const sessionId = number(payload.sessionId)
    const receivedAt = Date.now()
    if (state.latestFrame !== undefined && receivedAt - state.lastAcceptedFrameAt < 33) {
      void client.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
      return
    }
    const metadata = record(payload.metadata)
    state.lastAcceptedFrameAt = receivedAt
    state.frameSequence += 1
    state.latestFrame = {
      streamGeneration: state.streamGeneration,
      sequence: state.frameSequence,
      mediaType: 'image/jpeg',
      data: string(payload.data),
      width: number(metadata.deviceWidth),
      height: number(metadata.deviceHeight),
      viewportGeneration: view.viewport.generation,
    }
    const recorder = dependencies.recorderStatus(session)
    if (recorder.mode === 'deep' && recorder.status === 'recording') dependencies.recordVisualFrame(session, view, state, metadata)
    void client.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
}
