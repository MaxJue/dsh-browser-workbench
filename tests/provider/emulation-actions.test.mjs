import assert from 'node:assert/strict'
import test from 'node:test'
import { emulateBrowser } from '../../src/provider/emulation-actions.ts'
import { STANDARD_VIEWPORT } from '../../src/view/viewport.ts'

function setup() {
  const sent = []
  const state = {
    session: { send: async (...args) => { sent.push(args); return {} } },
    latestFrame: { frame: 'stale' },
  }
  const view = {
    viewId: 'view-1',
    viewport: {
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
      generation: 2,
      contentWidth: 800,
      fittedWidth: 800,
      reflowedElements: 3,
      fitDocumentGeneration: 4,
    },
  }
  const session = { liveView: { mode: 'adaptive', initialized: true, fixedWidth: 800, fixedHeight: 600, changedAt: 1 } }
  const calls = { cleared: 0, grants: [], permissionsCleared: 0 }
  const dependencies = {
    view,
    state,
    session,
    clearAdaptiveFit: async () => { calls.cleared += 1 },
    grantPermissions: async (...args) => calls.grants.push(args),
    clearPermissions: async () => { calls.permissionsCleared += 1 },
  }
  return { sent, state, view, session, calls, dependencies }
}

test('viewport override synchronizes live state and invalidates the current frame', async () => {
  const { sent, state, view, session, calls, dependencies } = setup()

  const result = await emulateBrowser({ action: 'viewport', width: 1280, height: 720, deviceScaleFactor: 2, mobile: true }, dependencies)

  assert.equal(calls.cleared, 1)
  assert.deepEqual(sent, [['Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 2, mobile: true }]])
  assert.deepEqual(view.viewport, { width: 1280, height: 720, deviceScaleFactor: 2, mobile: true, generation: 3, contentWidth: 1280, fittedWidth: 1280, reflowedElements: 0, fitDocumentGeneration: -1 })
  assert.equal(state.latestFrame, undefined)
  assert.deepEqual(session.liveView, { mode: 'standard', initialized: true, fixedWidth: 1280, fixedHeight: 720, changedAt: session.liveView.changedAt })
  assert.equal(result.data.action, 'viewport')
})

test('device emulation applies device metrics, user agent and touch state', async () => {
  const { sent, view, dependencies } = setup()

  await emulateBrowser({ action: 'device', device: 'iPhone 13' }, dependencies)

  assert.equal(callsafe(sent[0][0]), 'Emulation.setDeviceMetricsOverride')
  assert.deepEqual(sent.slice(1).map(item => item[0]), ['Emulation.setUserAgentOverride', 'Emulation.setTouchEmulationEnabled'])
  assert.equal(view.viewport.width, sent[0][1].width)
  assert.equal(view.viewport.height, sent[0][1].height)
  assert.equal(view.viewport.mobile, true)
})

function callsafe(value) {
  return value
}

test('network emulation converts Kbps to bytes per second and offline defaults to true', async () => {
  const { sent, dependencies } = setup()

  await emulateBrowser({ action: 'network', latencyMs: 75, downloadKbps: 800, uploadKbps: 64 }, dependencies)
  await emulateBrowser({ action: 'offline' }, dependencies)

  assert.deepEqual(sent, [
    ['Network.enable'],
    ['Network.emulateNetworkConditions', { offline: false, latency: 75, downloadThroughput: 102400, uploadThroughput: 8192 }],
    ['Network.enable'],
    ['Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }],
  ])
})

test('permissions are delegated with an optional origin', async () => {
  const { calls, dependencies } = setup()

  await emulateBrowser({ action: 'permissions', permissions: ['geolocation'], origin: 'https://example.test' }, dependencies)

  assert.deepEqual(calls.grants, [[['geolocation'], 'https://example.test']])
})

test('reset restores standard viewport and tolerates unavailable CDP resets', async () => {
  const { sent, state, view, session, calls, dependencies } = setup()
  state.session.send = async (...args) => {
    sent.push(args)
    if (args[0] === 'Emulation.clearDeviceMetricsOverride') throw new Error('unsupported')
    return {}
  }

  await emulateBrowser({ action: 'reset' }, dependencies)

  assert.equal(calls.cleared, 1)
  assert.equal(calls.permissionsCleared, 1)
  assert.deepEqual(view.viewport, { ...view.viewport, ...STANDARD_VIEWPORT, deviceScaleFactor: 1, mobile: false, generation: 3, contentWidth: STANDARD_VIEWPORT.width, fittedWidth: STANDARD_VIEWPORT.width, reflowedElements: 0, fitDocumentGeneration: -1 })
  assert.equal(session.liveView.mode, 'standard')
  assert.equal(session.liveView.fixedWidth, STANDARD_VIEWPORT.width)
  assert.equal(session.liveView.fixedHeight, STANDARD_VIEWPORT.height)
  assert.equal(state.latestFrame, undefined)
  assert.equal(sent.length, 5)
})

