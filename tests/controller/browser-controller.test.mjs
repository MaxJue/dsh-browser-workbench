import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserControllerStore } from '../../src/controller/browser-controller.ts'

const OWNED_TOOL = 'browser_snapshot'

function createAgent(sessionId) {
  const guards = []
  const agent = {
    session: { id: sessionId, header: { createdAt: 1792994312900, origin: 'user' } },
    status: 'idle',
    guards,
    ctx: {
      tools: {
        guard: check => {
          guards.push(check)
          return () => {
            const index = guards.indexOf(check)
            if (index >= 0) guards.splice(index, 1)
          }
        },
        restrict: () => () => {},
      },
      on: () => () => {},
    },
    inject: () => {},
    whenIdle: async () => {},
    runMaintenance: async task => task(),
  }
  return agent
}

async function createStore(storageRoot, releaseRuntime) {
  return new BrowserControllerStore({
    ctx: { tools: { schemas: () => [] } },
    storageRoot,
    config: { conflictingToolPatterns: ['^browser_'], includeTools: [], excludeTools: [] },
    toolDefinitions: [{ name: OWNED_TOOL }],
    registerTools: () => () => {},
    releaseRuntime,
    isOwnedTool: name => name === OWNED_TOOL,
  })
}

async function withStore(releaseRuntime, run) {
  const storageRoot = await mkdtemp(join(tmpdir(), 'bw-controller-'))
  try {
    const store = await createStore(storageRoot, releaseRuntime)
    const agent = createAgent('session-1')
    store.attach(agent)
    await run(store, agent)
  } finally {
    await rm(storageRoot, { recursive: true, force: true })
  }
}

test('release reports the release moment and clears it when a browser tool runs again', async () => {
  const calls = []
  await withStore(async (sessionId, createdAt) => {
    calls.push([sessionId, createdAt])
    return true
  }, async (store, agent) => {
    const activated = await store.activate('session-1')
    assert.equal(activated.status, 'active')
    assert.equal(activated.releasedAt, undefined)

    const before = Date.now()
    const after = await store.release('session-1')
    assert.equal(after.status, 'active')
    assert.deepEqual(calls, [['session-1', 1792994312900]])
    assert.equal(typeof after.releasedAt, 'number')
    assert.ok(after.releasedAt >= before)

    // 工具再次执行意味着浏览器资源可能被重新创建，上一次释放回执必须失效。
    assert.equal(agent.guards.length, 1)
    agent.guards[0]({ name: OWNED_TOOL })
    assert.equal(store.snapshot('session-1').releasedAt, undefined)

    // 非本插件工具的执行不影响释放回执。
    const second = await store.release('session-1')
    assert.equal(typeof second.releasedAt, 'number')
    agent.guards[0]({ name: 'other_tool' })
    assert.equal(store.snapshot('session-1').releasedAt, second.releasedAt)
  })
})

test('release fails loudly when the runtime has no resources left', async () => {
  let released = true
  await withStore(async () => released, async (store) => {
    await store.activate('session-1')
    const first = await store.release('session-1')
    assert.equal(typeof first.releasedAt, 'number')

    released = false
    await assert.rejects(
      () => store.release('session-1'),
      /当前 Session 没有正在使用的 BrowserWorkbench 资源。/,
    )
    const snapshot = store.snapshot('session-1')
    assert.equal(snapshot.status, 'active')
    assert.equal(snapshot.releasedAt, first.releasedAt)
    assert.equal(snapshot.error, '当前 Session 没有正在使用的 BrowserWorkbench 资源。')
  })
})
