import type { Page } from 'playwright-core'
import type { SessionState, ViewState } from '../domain/types.ts'
import type { EventJournal } from '../diagnostics/event-journal.ts'
import type { FlightRecorderStore } from '../diagnostics/flight-recorder.ts'
import { parseGeneratedLocation } from '../diagnostics/source-map-resolver.ts'
import { redactUrl } from '../domain/policy.ts'

export function bindPageDiagnosticEvents(
  page: Page,
  session: SessionState,
  view: ViewState,
  maxOutputChars: number,
  journal: EventJournal,
  recorder: FlightRecorderStore,
): void {
  page.on('console', message => {
    const text = message.text().slice(0, maxOutputChars)
    const location = message.location()
    view.console.push({ level: message.type(), text, time: Date.now() })
    if (view.console.length > 200) view.console.splice(0, view.console.length - 200)
    const contextIdentity = view.cdp?.contextAdapter?.isEnabled()
      ? view.cdp.contextAdapter.contextForUrl(location.url)
      : {}
    journal.recordConsole({
      sessionId: session.sessionId,
      sessionKey: session.key,
      viewId: view.viewId,
      contextGeneration: session.contextGeneration,
      documentGeneration: view.documentGeneration,
      navigationId: view.navigationId,
      ...contextIdentity,
      source: 'console',
      level: message.type(),
      text,
      ...(location.url === '' ? {} : { url: redactUrl(location.url) }),
      ...(location.lineNumber === 0 ? {} : { line: location.lineNumber }),
      ...(location.columnNumber === 0 ? {} : { column: location.columnNumber }),
    })
    recorder.record(session.sessionId, session.key, {
      source: 'page',
      kind: 'console',
      viewId: view.viewId,
      documentGeneration: view.documentGeneration,
      navigationId: view.navigationId,
      ...contextIdentity,
      outcome: /error|assert/i.test(message.type()) ? 'error' : message.type(),
      labels: { level: message.type() },
    })
  })

  page.on('pageerror', error => {
    const stack = error.stack?.slice(0, maxOutputChars)
    const location = parseGeneratedLocation(stack)
    const text = error.message.slice(0, maxOutputChars)
    view.console.push({ level: 'error', text, time: Date.now() })
    if (view.console.length > 200) view.console.splice(0, view.console.length - 200)
    const contextIdentity = view.cdp?.contextAdapter?.isEnabled()
      ? view.cdp.contextAdapter.contextForUrl(location?.url ?? '')
      : {}
    journal.recordConsole({
      sessionId: session.sessionId,
      sessionKey: session.key,
      viewId: view.viewId,
      contextGeneration: session.contextGeneration,
      documentGeneration: view.documentGeneration,
      navigationId: view.navigationId,
      ...contextIdentity,
      source: 'pageerror',
      level: 'error',
      text,
      ...(location === undefined ? {} : { url: redactUrl(location.url), line: location.line, column: location.column }),
      ...(stack === undefined ? {} : { stack }),
    })
    recorder.record(session.sessionId, session.key, {
      source: 'page',
      kind: 'page-error',
      viewId: view.viewId,
      documentGeneration: view.documentGeneration,
      navigationId: view.navigationId,
      ...contextIdentity,
      outcome: 'error',
    })
  })
}
