import type { SessionState } from '../domain/types.ts'
import type { CdpState } from './cdp-state.ts'
import { number, string, type RawCdpSession } from './cdp-raw.ts'
import { pausedCallFrames } from './cdp-state.ts'

export function bindCdpDebuggerLifecycle(client: RawCdpSession, state: CdpState): void {
  client.on('Debugger.paused', payload => {
    state.paused = true
    state.reason = string(payload.reason)
    state.callFrames = pausedCallFrames(payload)
  })
  client.on('Debugger.resumed', () => {
    state.paused = false
    state.reason = undefined
    state.callFrames = []
  })
}

export interface CdpTargetLifecycleDependencies {
  deactivateExecutionContext: (sessionKey: string, executionContextId: number) => void
  deactivateTarget: (sessionKey: string, targetId: string) => void
}

export function bindCdpTargetLifecycle(
  client: RawCdpSession,
  session: SessionState,
  state: CdpState,
  dependencies: CdpTargetLifecycleDependencies,
): void {
  client.on('Runtime.executionContextDestroyed', payload => {
    const executionContextId = number(payload.executionContextId)
    if (executionContextId !== 0) dependencies.deactivateExecutionContext(session.key, executionContextId)
  })
  client.on('Runtime.executionContextsCleared', () => {
    const targetId = state.contextAdapter?.mainContext().targetId
    if (targetId !== undefined) dependencies.deactivateTarget(session.key, targetId)
  })
  client.on('Target.detachedFromTarget', payload => {
    const targetId = string(payload.targetId)
    if (targetId !== '') dependencies.deactivateTarget(session.key, targetId)
  })
}
