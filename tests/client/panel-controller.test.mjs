import assert from 'node:assert/strict'
import test from 'node:test'
import { createPanelController } from '../../src/client/panel-controller.ts'

test('panel controller tracks mount, view updates, and subscriptions', () => {
  const opened = []
  const controller = createPanelController(view => opened.push(view))
  const states = []
  const unsubscribe = controller.subscribe('session-a', state => states.push(state))

  assert.deepEqual(states, [], 'subscribing must not notify synchronously')
  assert.deepEqual(controller.getSnapshot('session-a'), { open: false })
  assert.deepEqual(controller.open('session-a', 'live'), { ok: true })
  assert.deepEqual(opened, ['live'])

  const closeTab = () => {}
  const openTab = view => opened.push(`mounted:${view}`)
  const detach = controller.attach('session-a', 'tab-a', closeTab, openTab)
  assert.deepEqual(states.at(-1), { open: true, view: undefined })
  assert.deepEqual(controller.getSnapshot('session-a'), { open: true, view: undefined })
  controller.update('session-a', 'tab-a', 'network')
  assert.deepEqual(states.at(-1), { open: true, view: 'network' })
  assert.deepEqual(controller.getSnapshot('session-a'), { open: true, view: 'network' })
  assert.deepEqual(controller.open('session-a', 'diagnostic'), { ok: true })
  assert.deepEqual(opened.at(-1), 'mounted:diagnostic')

  detach()
  assert.deepEqual(states.at(-1), { open: false })
  assert.deepEqual(controller.getSnapshot('session-a'), { open: false })
  unsubscribe()
})

test('subscribe never notifies during subscription (re-subscribing must not loop renders)', () => {
  const controller = createPanelController(() => {})
  controller.attach('session-a', 'tab-a', () => {}, () => {})
  const seen = []
  const first = controller.subscribe('session-a', state => seen.push(state))
  const second = controller.subscribe('session-a', state => seen.push(state))
  assert.deepEqual(seen, [], 'useSyncExternalStore re-subscribes on every render; a notify here loops forever')

  controller.update('session-a', 'tab-a', 'console')
  assert.deepEqual(seen, [
    { open: true, view: 'console' },
    { open: true, view: 'console' },
  ])
  first()
  second()
})

test('snapshots keep a stable identity until the mount state changes', () => {
  const controller = createPanelController(() => {})
  const first = controller.getSnapshot('session-a')
  assert.equal(controller.getSnapshot('session-a'), first, 'repeat reads must return the same object for useSyncExternalStore')
  assert.equal(controller.getSnapshot('session-b'), controller.getSnapshot('session-b'))

  const detach = controller.attach('session-a', 'tab-a', () => {}, () => {})
  const mounted = controller.getSnapshot('session-a')
  assert.notEqual(mounted, first)
  assert.equal(controller.getSnapshot('session-a'), mounted)

  controller.update('session-a', 'tab-a', 'diagnostic')
  const updated = controller.getSnapshot('session-a')
  assert.notEqual(updated, mounted)
  assert.equal(controller.getSnapshot('session-a'), updated)

  detach()
  assert.equal(controller.getSnapshot('session-a'), first)
})

test('stale detach cannot remove a newer mounted tab', () => {
  const controller = createPanelController(() => {})
  const firstDetach = controller.attach('session-a', 'tab-a', () => {}, () => {})
  controller.attach('session-a', 'tab-b', () => {}, () => {})
  firstDetach()

  const states = []
  const unsubscribe = controller.subscribe('session-a', state => states.push(state))
  assert.deepEqual(states, [])
  controller.close('session-a')
  assert.deepEqual(states, [{ open: false }])
  unsubscribe()
})

test('close targets one session or all mounted sessions', () => {
  const closed = []
  const controller = createPanelController(() => {})
  controller.attach('session-a', 'tab-a', () => closed.push('a'), () => {})
  controller.attach('session-b', 'tab-b', () => closed.push('b'), () => {})
  controller.close('session-a')
  assert.deepEqual(closed, ['a'])
  controller.close()
  assert.deepEqual(closed, ['a', 'b'])
})

