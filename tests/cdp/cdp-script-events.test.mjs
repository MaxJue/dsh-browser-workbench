import assert from 'node:assert/strict'
import test from 'node:test'
import { bindCdpScriptEvents } from '../../src/cdp/cdp-script-events.ts'

test('scriptParsed indexes scripts, registers build identity, and records contextual scripts', () => {
  const handlers = new Map()
  const events = []
  const identity = { targetId: 'target-1', executionContextId: 7 }
  const state = {
    scripts: new Map(),
    contextAdapter: {
      isEnabled: () => true,
      contextForExecution: id => ({ ...identity, executionContextId: id }),
      registerScript: (...args) => events.push(['context-script', ...args]),
    },
  }
  const session = { sessionId: 's1', key: 's1@1', contextGeneration: 3 }
  const view = { viewId: 'v1', documentGeneration: 4, navigationId: 'v1-n2' }
  const client = { on: (event, listener) => handlers.set(event, listener) }
  const journal = { recordScript: event => events.push(['journal', event]) }
  const builds = []
  bindCdpScriptEvents(client, session, view, state, journal, {
    registerBuildScript: (...args) => builds.push(args),
  })

  handlers.get('Debugger.scriptParsed')({
    scriptId: 'script-1',
    executionContextId: 7,
    url: 'https://example.test/app.js',
    sourceMapURL: '/app.js.map',
    startLine: 1,
    startColumn: 2,
    endLine: 9,
    endColumn: 4,
  })

  assert.equal(state.scripts.get('script-1').executionContextId, 7)
  assert.equal(builds[0][0], 's1@1')
  assert.equal(builds[0][1].navigationId, 'v1-n2')
  assert.deepEqual(events.map(event => event[0]), ['context-script', 'journal'])
  assert.equal(events[1][1].sourceMapUrl, '/app.js.map')
  assert.equal(events[1][1].contextGeneration, 3)
})

test('scriptParsed without an id is ignored and global scripts omit context records', () => {
  const handlers = new Map()
  const builds = []
  const scripts = []
  const state = { scripts: new Map(), contextAdapter: { isEnabled: () => false } }
  bindCdpScriptEvents(
    { on: (event, listener) => handlers.set(event, listener) },
    { sessionId: 's1', key: 's1@1', contextGeneration: 0 },
    { viewId: 'v1', documentGeneration: 1, navigationId: 'v1-n1' },
    state,
    { recordScript: event => scripts.push(event) },
    { registerBuildScript: (...args) => builds.push(args) },
  )

  handlers.get('Debugger.scriptParsed')({ scriptId: '' })
  handlers.get('Debugger.scriptParsed')({ scriptId: 'global', executionContextId: 0, url: 'injected.js' })

  assert.equal(state.scripts.size, 1)
  assert.equal(builds.length, 1)
  assert.equal(scripts.length, 0)
})

