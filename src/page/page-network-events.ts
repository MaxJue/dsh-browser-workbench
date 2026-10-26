import type { Page, Request } from 'playwright-core'
import type { SessionState, ViewState } from '../domain/types.ts'
import type { EventJournal } from '../diagnostics/event-journal.ts'
import type { FlightRecorderStore } from '../diagnostics/flight-recorder.ts'

export function bindPageNetworkEvents(
  page: Page,
  session: SessionState,
  view: ViewState,
  legacyRequests: WeakMap<Request, ViewState['network'][number]>,
  journal: EventJournal,
  recorder: FlightRecorderStore,
  onRequest: (request: Request) => void,
): void {
  page.on('request', onRequest)
  page.on('response', response => {
    const request = response.request()
    const item = legacyRequests.get(request)
    if (item !== undefined) item.status = response.status()
    journal.recordResponse(request, response.status())
    const frameIdentity = view.cdp?.contextAdapter?.isEnabled()
      ? view.cdp.contextAdapter.contextForFrame(request.frame())
      : {}
    recorder.record(session.sessionId, session.key, {
      source: 'page',
      kind: 'network-response',
      viewId: view.viewId,
      documentGeneration: view.documentGeneration,
      navigationId: view.navigationId,
      ...frameIdentity,
      outcome: String(response.status()),
      metrics: { status: response.status() },
      labels: { method: request.method(), resourceType: request.resourceType() },
    })
  })
  page.on('requestfailed', request => {
    const item = legacyRequests.get(request)
    if (item !== undefined) item.failure = request.failure()?.errorText ?? 'request failed'
    const failedNavigationId = journal.requestNavigationId(request)
    journal.recordRequestFailure(request, request.failure()?.errorText ?? 'request failed')
    const frameIdentity = view.cdp?.contextAdapter?.isEnabled()
      ? view.cdp.contextAdapter.contextForFrame(request.frame())
      : {}
    recorder.record(session.sessionId, session.key, {
      source: 'page',
      kind: 'network-failure',
      viewId: view.viewId,
      documentGeneration: view.documentGeneration,
      navigationId: failedNavigationId ?? view.navigationId,
      ...frameIdentity,
      outcome: 'failed',
      labels: { method: request.method(), resourceType: request.resourceType() },
    })
    if (request.isNavigationRequest()
      && request.frame() === page.mainFrame()
      && failedNavigationId !== undefined
      && failedNavigationId === view.pendingNavigationId) {
      view.pendingNavigationId = undefined
    }
  })
  page.on('requestfinished', request => journal.recordRequestFinished(request))
}
