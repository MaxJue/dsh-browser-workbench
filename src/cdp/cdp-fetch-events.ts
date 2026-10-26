import type { CdpState } from './cdp-state.ts'
import { redactUrl } from '../domain/policy.ts'
import { record, string, type RawCdpSession } from './cdp-raw.ts'

export function bindCdpFetchEvents(client: RawCdpSession, state: CdpState, timeoutMs: number): void {
  client.on('Fetch.requestPaused', payload => {
    const request = record(payload.request)
    const requestId = string(payload.requestId)
    if (requestId === '') return
    const previous = state.pausedRequests.get(requestId)
    if (previous !== undefined) clearTimeout(previous.timer)
    const timer = setTimeout(() => {
      const paused = state.pausedRequests.get(requestId)
      if (paused === undefined) return
      state.pausedRequests.delete(requestId)
      void client.send('Fetch.continueRequest', { requestId }).catch(() => {})
    }, timeoutMs)
    state.pausedRequests.set(requestId, {
      requestId,
      ...(string(payload.networkId) === '' ? {} : { networkId: string(payload.networkId) }),
      url: redactUrl(string(request.url)),
      rawUrl: string(request.url),
      method: string(request.method),
      resourceType: string(payload.resourceType),
      requestStage: typeof payload.responseStatusCode === 'number' ? 'response' : 'request',
      ...(typeof payload.responseStatusCode === 'number' ? { responseStatusCode: payload.responseStatusCode } : {}),
      ...(typeof payload.responseStatusText === 'string' ? { responseStatusText: payload.responseStatusText } : {}),
      headers: Object.entries(record(request.headers)).map(([name, value]) => ({
        name,
        value: /authorization|cookie|token|secret|password/i.test(name) ? '[REDACTED]' : String(value),
      })),
      ...(typeof request.postData === 'string' ? { postData: request.postData } : {}),
      createdAt: Date.now(),
      timer,
    })
  })
}
