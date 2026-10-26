import assert from 'node:assert/strict'
import test from 'node:test'
import { isBrowserPanelView, liveViewPreference, panelViews, saveLiveViewPreference, valueOf } from '../../src/client/panel-model.ts'

test('unwraps successful RPC responses and surfaces host errors', () => {
  assert.deepEqual(valueOf({ ok: true, value: { ready: true } }), { ready: true })
  assert.throws(() => valueOf({ ok: false, error: { message: 'denied' } }), /denied/)
  assert.throws(() => valueOf({ ok: false }), /browser panel request failed/)
})

test('recognizes only registered panel views', () => {
  assert.equal(isBrowserPanelView('diagnostic'), true)
  assert.equal(isBrowserPanelView('unknown'), false)
  assert.equal(isBrowserPanelView(null), false)
  assert.equal(new Set(panelViews).size, panelViews.length)
})

test('reads and writes live view preference with safe fallbacks', () => {
  const values = new Map()
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  assert.equal(liveViewPreference(), 'adaptive')
  saveLiveViewPreference('standard')
  assert.equal(liveViewPreference(), 'standard')
  saveLiveViewPreference('adaptive')
  assert.equal(liveViewPreference(), 'adaptive')

  globalThis.localStorage = { getItem() { throw new Error('storage unavailable') }, setItem() { throw new Error('storage unavailable') } }
  assert.equal(liveViewPreference(), 'adaptive')
  assert.doesNotThrow(() => saveLiveViewPreference('standard'))
})
