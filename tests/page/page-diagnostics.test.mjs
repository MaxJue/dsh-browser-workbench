import assert from 'node:assert/strict'
import test from 'node:test'
import { bindPageDiagnosticEvents } from '../../src/page/page-diagnostics.ts'

function fixture() {
  const handlers = new Map()
  const consoleEvents = []
  const recorderEvents = []
  const page = { on: (event, listener) => handlers.set(event, listener) }
  const session = { sessionId: 'session', key: 'session@1', contextGeneration: 2 }
  const view = { viewId: 'v1', documentGeneration: 3, navigationId: 'v1-n2', console: [] }
  const journal = { recordConsole: event => consoleEvents.push(event) }
  const recorder = { record: (...args) => recorderEvents.push(args) }
  bindPageDiagnosticEvents(page, session, view, 12, journal, recorder)
  return { handlers, view, consoleEvents, recorderEvents }
}

test('page console diagnostics are bounded, URL-redacted, and recorded', () => {
  const { handlers, view, consoleEvents, recorderEvents } = fixture()
  handlers.get('console')({
    text: () => 'abcdefghijklmnop',
    type: () => 'error',
    location: () => ({ url: 'https://example.test/app?token=secret', lineNumber: 4, columnNumber: 2 }),
  })

  assert.equal(view.console[0].text.length, 12)
  assert.equal(consoleEvents[0].url, 'https://example.test/app?token=%5BREDACTED%5D')
  assert.equal(recorderEvents[0][2].outcome, 'error')
})

test('page errors produce a bounded console entry and page-error recording', () => {
  const { handlers, view, consoleEvents, recorderEvents } = fixture()
  handlers.get('pageerror')(new Error('page exploded'))
  assert.deepEqual(view.console.map(event => event.level), ['error'])
  assert.equal(consoleEvents[0].source, 'pageerror')
  assert.equal(recorderEvents[0][2].kind, 'page-error')
})

