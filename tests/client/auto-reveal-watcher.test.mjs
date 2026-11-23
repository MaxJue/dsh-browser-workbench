import assert from 'node:assert/strict'
import test from 'node:test'
import { installAutoReveal } from '../../src/client/auto-reveal-watcher.ts'
import { createPanelController } from '../../src/client/panel-controller.ts'

const page = { available: true, tabCount: 1, activeViewId: 'view-a', activeUrl: 'https://example.com' }

function createSessions(sessionId = 'session-a') {
  let current = sessionId
  const running = new Map()
  const listeners = new Set()
  return {
    source: {
      current: () => current,
      subscribe: listener => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      running: id => running.get(id),
    },
    setRunning(value) {
      running.set(current, value)
      for (const listener of listeners) listener()
    },
    switchTo(next) {
      current = next
      for (const listener of listeners) listener()
    },
    notify() {
      for (const listener of listeners) listener()
    },
  }
}

function createTimer() {
  let task
  let stopped = 0
  return {
    timer: {
      repeat(next) {
        task = next
        return () => { stopped += 1; task = undefined }
      },
    },
    /** 手动跑一轮轮询，并等 tick 的异步探测落定。 */
    async flush() {
      if (task === undefined) throw new Error('no polling timer is running')
      task()
      await new Promise(resolve => setImmediate(resolve))
      await new Promise(resolve => setImmediate(resolve))
    },
    get polling() { return task !== undefined },
    get stopped() { return stopped },
  }
}

function createHarness({ sessionId = 'session-a', activity = page, probe } = {}) {
  const opened = []
  const controller = createPanelController(view => opened.push(view))
  const sessions = createSessions(sessionId)
  const clock = createTimer()
  const probes = []
  const dispose = installAutoReveal({
    sessions: sessions.source,
    controller,
    probe: async id => {
      probes.push(id)
      if (probe !== undefined) return probe(id, probes.length)
      return activity
    },
    view: 'live',
    timer: clock.timer,
  })
  return { controller, sessions, clock, opened, probes, dispose }
}

test('auto reveal opens the live panel for new content during a running turn', async () => {
  const harness = createHarness()
  try {
    // 没有回答进行中时不轮询，也不打开面板。
    assert.equal(harness.clock.polling, false)
    harness.sessions.setRunning(true)
    assert.equal(harness.clock.polling, true)

    await harness.clock.flush()
    assert.deepEqual(harness.probes, ['session-a'])
    assert.deepEqual(harness.opened, ['live'])
    assert.equal(harness.clock.polling, false, 'revealing stops polling until the panel mounts')

    // 面板挂载后仍未运行结束，但面板已开，不再轮询。
    harness.controller.attach('session-a', 'tab-a', () => {}, () => {})
    assert.equal(harness.clock.polling, false)
  } finally {
    harness.dispose()
  }
})

test('auto reveal stays quiet without a running turn or with the panel already open', async () => {
  const idle = createHarness()
  try {
    idle.sessions.setRunning(false)
    assert.equal(idle.clock.polling, false)
    assert.deepEqual(idle.opened, [])
  } finally {
    idle.dispose()
  }

  const open = createHarness()
  try {
    open.controller.attach('session-a', 'tab-a', () => {}, () => {})
    open.sessions.setRunning(true)
    assert.equal(open.clock.polling, false)
    assert.deepEqual(open.opened, [])
  } finally {
    open.dispose()
  }
})

test('a probe without a page never opens the panel', async () => {
  const harness = createHarness({ activity: { available: true, tabCount: 0 } })
  try {
    harness.sessions.setRunning(true)
    await harness.clock.flush()
    assert.deepEqual(harness.opened, [])
    assert.equal(harness.clock.polling, true, 'empty probes keep watching for the first page')
  } finally {
    harness.dispose()
  }
})

test('closing an auto-revealed panel dismisses the rest of the turn and the next turn wakes up', async () => {
  let activity = page
  const harness = createHarness({ probe: () => activity })
  try {
    harness.sessions.setRunning(true)
    await harness.clock.flush()
    assert.deepEqual(harness.opened, ['live'])

    const detach = harness.controller.attach('session-a', 'tab-a', () => {}, () => {})
    detach()
    assert.equal(harness.clock.polling, false, 'the user closed the panel; stop watching this turn')

    // 同一轮内浏览器继续变化也不再展开。
    activity = { ...page, activeUrl: 'https://iana.org' }
    harness.sessions.setRunning(true)
    harness.sessions.notify()
    assert.equal(harness.clock.polling, false)

    // 本轮结束，下一轮回答重新获得一次自动展开机会。
    harness.sessions.setRunning(false)
    harness.sessions.setRunning(true)
    assert.equal(harness.clock.polling, true)
    await harness.clock.flush()
    assert.deepEqual(harness.opened, ['live', 'live'])
  } finally {
    harness.dispose()
  }
})

test('a probe failure is swallowed and retried on the next tick', async () => {
  const harness = createHarness({
    probe: (_id, attempt) => {
      if (attempt === 1) throw new Error('host unavailable')
      return page
    },
  })
  try {
    harness.sessions.setRunning(true)
    await harness.clock.flush()
    assert.deepEqual(harness.opened, [])
    assert.equal(harness.clock.polling, true)

    await harness.clock.flush()
    assert.deepEqual(harness.opened, ['live'])
    assert.equal(harness.probes.length, 2)
  } finally {
    harness.dispose()
  }
})

test('switching the main session re-targets the probe and stops on dispose', async () => {
  const harness = createHarness()
  harness.sessions.setRunning(true)
  await harness.clock.flush()
  assert.deepEqual(harness.opened, ['live'])

  harness.sessions.switchTo('session-b')
  assert.equal(harness.clock.polling, false, 'the new session has no running baseline yet')
  harness.sessions.setRunning(true)
  assert.equal(harness.clock.polling, true)
  await harness.clock.flush()
  assert.deepEqual(harness.probes, ['session-a', 'session-b'])
  assert.deepEqual(harness.opened, ['live', 'live'])

  harness.dispose()
  assert.equal(harness.clock.polling, false)
})
