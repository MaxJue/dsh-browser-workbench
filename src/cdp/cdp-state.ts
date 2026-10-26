import type { CDPSession } from 'playwright-core'
import type { BrowserCallFrame } from '../domain/protocol.ts'
import type { ViewState } from '../domain/types.ts'
import { number, record, string } from './cdp-raw.ts'

export type CdpState = NonNullable<ViewState['cdp']>

export function createCdpState(session: CDPSession, viewportGeneration: number): CdpState {
  return {
    session,
    debuggerEnabled: false,
    paused: false,
    callFrames: [],
    scripts: new Map(),
    breakpoints: new Map(),
    screencastStarted: false,
    screencastConsumers: new Set(),
    streamGeneration: viewportGeneration + 1,
    frameSequence: 0,
    lastAcceptedFrameAt: 0,
    networkEnabled: false,
    pausedRequests: new Map(),
    profile: {
      traceActive: false,
      cpuActive: false,
      jsCoverageActive: false,
      cssCoverageActive: false,
      heapSamplingActive: false,
      artifacts: [],
    },
  }
}

export function pausedCallFrames(payload: Record<string, unknown>): BrowserCallFrame[] {
  const frames = Array.isArray(payload.callFrames) ? payload.callFrames : []
  return frames.map(value => {
    const frame = record(value)
    const location = record(frame.location)
    const scopeChain = Array.isArray(frame.scopeChain) ? frame.scopeChain : []
    return {
      callFrameId: string(frame.callFrameId),
      functionName: string(frame.functionName) || '(anonymous)',
      url: string(frame.url),
      lineNumber: number(location.lineNumber),
      columnNumber: number(location.columnNumber),
      scopes: scopeChain.map(scopeValue => {
        const scope = record(scopeValue)
        const object = record(scope.object)
        const name = string(scope.name)
        const objectId = string(object.objectId)
        return {
          type: string(scope.type),
          ...(name === '' ? {} : { name }),
          ...(objectId === '' ? {} : { objectId }),
        }
      }),
    }
  })
}
