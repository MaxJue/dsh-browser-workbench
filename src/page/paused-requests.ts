import type { ViewState } from '../domain/types.ts'
import type { CdpState } from '../cdp/cdp-state.ts'
import { rawCdp } from '../cdp/cdp-raw.ts'

type PausedRequestOwner = Pick<ViewState, 'cdp'> | { cdp?: CdpState }

export function projectPausedCdpRequests(state: CdpState) {
  return [...state.pausedRequests.values()].map(item => ({
    requestId: item.requestId,
    url: item.url,
    method: item.method,
    resourceType: item.resourceType,
    requestStage: item.requestStage,
    ...(item.responseStatusCode === undefined ? {} : { responseStatusCode: item.responseStatusCode }),
    ...(item.responseStatusText === undefined ? {} : { responseStatusText: item.responseStatusText }),
    createdAt: item.createdAt,
  }))
}

export function projectPausedRequests(view: PausedRequestOwner) {
  return view.cdp === undefined ? [] : projectPausedCdpRequests(view.cdp)
}

export async function releasePausedCdpRequests(state: CdpState): Promise<void> {
  const client = rawCdp(state.session)
  await Promise.all([...state.pausedRequests.values()].map(async item => {
    clearTimeout(item.timer)
    await client.send('Fetch.continueRequest', { requestId: item.requestId }).catch(() => {})
  }))
  state.pausedRequests.clear()
}

export async function releasePausedRequests(view: PausedRequestOwner): Promise<void> {
  if (view.cdp !== undefined) await releasePausedCdpRequests(view.cdp)
}
