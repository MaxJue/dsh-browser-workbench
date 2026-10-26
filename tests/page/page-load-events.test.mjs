import assert from 'node:assert/strict'
import test from 'node:test'
import { bindPageLoadEvents } from '../../src/page/page-load-events.ts'

function fixture(overrides = {}) {
  const handlers = new Map()
  const calls = []
  const page = { on: (event, listener) => handlers.set(event, listener), isClosed: () => overrides.closed ?? false }
  const session = { liveView: { mode: overrides.mode ?? 'adaptive' } }
  const view = { kind: overrides.kind ?? 'page' }
  bindPageLoadEvents(
    page,
    session,
    view,
    async (target, operation) => { calls.push(['queue', target]); await operation() },
    async (target, current) => calls.push(['viewport', target, current]),
  )
  return { handlers, session, view, calls }
}

test('adaptive page load reapplies the live viewport through the session queue', async () => {
  const { handlers, session, view, calls } = fixture()
  handlers.get('load')()
  await Promise.resolve()

  assert.deepEqual(calls, [['queue', session], ['viewport', session, view]])
})

test('page load ignores popups, standard mode, and closed pages', async () => {
  for (const overrides of [{ kind: 'extension-popup' }, { mode: 'standard' }, { closed: true }]) {
    const { handlers, calls } = fixture(overrides)
    handlers.get('load')()
    await Promise.resolve()
    assert.deepEqual(calls, [])
  }
})

