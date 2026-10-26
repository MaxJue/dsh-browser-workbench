import type { Request } from 'playwright-core'
import type { SessionState, ViewState } from '../domain/types.ts'
import type { EventJournal } from '../diagnostics/event-journal.ts'
import { redactUrl } from '../domain/policy.ts'

export function recordPageRequest(
  session: SessionState,
  view: ViewState,
  request: Request,
  legacyRequests: WeakMap<Request, ViewState['network'][number]>,
  journal: EventJournal,
): void {
  const item = { method: request.method(), url: redactUrl(request.url()), type: request.resourceType(), time: Date.now() }
  view.network.push(item)
  legacyRequests.set(request, item)
  if (view.network.length > 300) view.network.splice(0, view.network.length - 300)
  let navigationId = view.navigationId
  if (request.isNavigationRequest() && request.frame() === view.page.mainFrame()) {
    if (request.redirectedFrom() === null || view.pendingNavigationId === undefined) {
      view.navigationGeneration += 1
      view.pendingNavigationId = `${view.viewId}-n${view.navigationGeneration}`
    }
    navigationId = view.pendingNavigationId
  }
  const frameIdentity = view.cdp?.contextAdapter?.isEnabled()
    ? view.cdp.contextAdapter.contextForFrame(request.frame())
    : {}
  if (view.cdp?.contextAdapter?.isEnabled()) view.cdp.contextAdapter.registerResource(request.url(), frameIdentity)
  journal.startNetwork({
    sessionId: session.sessionId,
    sessionKey: session.key,
    viewId: view.viewId,
    contextGeneration: session.contextGeneration,
    documentGeneration: view.documentGeneration,
    navigationId,
    ...frameIdentity,
    request,
    method: request.method(),
    url: redactUrl(request.url()),
    resourceType: request.resourceType(),
    ...(request.redirectedFrom() === null ? {} : { redirectFrom: request.redirectedFrom() as Request }),
  })
}
