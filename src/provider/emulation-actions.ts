import { devices } from 'playwright-core'
import { fail } from '../domain/errors.ts'
import type { BrowserEmulateInput } from '../domain/protocol.ts'
import type { SessionState, ToolOutput, ViewState } from '../domain/types.ts'
import type { CdpState } from '../cdp/cdp-state.ts'
import { rawCdp } from '../cdp/cdp-raw.ts'
import { STANDARD_VIEWPORT } from '../view/viewport.ts'

interface EmulationDependencies {
  session: Pick<SessionState, 'liveView'>
  view: ViewState
  state: CdpState
  clearAdaptiveFit(view: ViewState): Promise<void>
  grantPermissions(permissions: string[], origin?: string): Promise<void>
  clearPermissions(): Promise<void>
}

function asData(value: unknown): ToolOutput['data'] {
  return value as ToolOutput['data']
}

function applyFixedViewport(view: ViewState, state: CdpState, session: Pick<SessionState, 'liveView'>, width: number, height: number, deviceScaleFactor: number, mobile: boolean): void {
  view.viewport.width = width
  view.viewport.height = height
  view.viewport.deviceScaleFactor = deviceScaleFactor
  view.viewport.mobile = mobile
  view.viewport.contentWidth = width
  view.viewport.fittedWidth = width
  view.viewport.reflowedElements = 0
  view.viewport.fitDocumentGeneration = -1
  view.viewport.generation += 1
  state.latestFrame = undefined
  session.liveView.mode = 'standard'
  session.liveView.initialized = true
  session.liveView.fixedWidth = width
  session.liveView.fixedHeight = height
  session.liveView.changedAt = Date.now()
}

export async function emulateBrowser(input: BrowserEmulateInput, dependencies: EmulationDependencies): Promise<ToolOutput> {
  const { session, view, state } = dependencies
  const client = rawCdp(state.session)
  if (input.action === 'viewport') {
    if (input.width === undefined || input.height === undefined) fail('INVALID_ARGS', 'viewport requires width and height')
    await dependencies.clearAdaptiveFit(view)
    await client.send('Emulation.setDeviceMetricsOverride', { width: input.width, height: input.height, deviceScaleFactor: input.deviceScaleFactor ?? 1, mobile: input.mobile ?? false })
    applyFixedViewport(view, state, session, input.width, input.height, input.deviceScaleFactor ?? 1, input.mobile ?? false)
  } else if (input.action === 'device') {
    if (input.device === undefined) fail('INVALID_ARGS', 'device requires device')
    const descriptor = devices[input.device]
    if (descriptor === undefined) fail('INVALID_ARGS', `unknown Playwright device ${JSON.stringify(input.device)}`)
    await dependencies.clearAdaptiveFit(view)
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: descriptor.viewport.width,
      height: descriptor.viewport.height,
      deviceScaleFactor: descriptor.deviceScaleFactor,
      mobile: descriptor.isMobile,
      screenOrientation: descriptor.viewport.width > descriptor.viewport.height ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 },
    })
    await client.send('Emulation.setUserAgentOverride', { userAgent: descriptor.userAgent })
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: descriptor.hasTouch })
    applyFixedViewport(view, state, session, descriptor.viewport.width, descriptor.viewport.height, descriptor.deviceScaleFactor, descriptor.isMobile)
  } else if (input.action === 'locale') {
    if (input.locale === undefined) fail('INVALID_ARGS', 'locale requires locale')
    await client.send('Emulation.setLocaleOverride', { locale: input.locale })
  } else if (input.action === 'timezone') {
    if (input.timezoneId === undefined) fail('INVALID_ARGS', 'timezone requires timezoneId')
    await client.send('Emulation.setTimezoneOverride', { timezoneId: input.timezoneId })
  } else if (input.action === 'network' || input.action === 'offline') {
    const offline = input.action === 'offline' ? input.offline ?? true : input.offline ?? false
    await client.send('Network.enable')
    await client.send('Network.emulateNetworkConditions', {
      offline,
      latency: input.latencyMs ?? 0,
      downloadThroughput: input.downloadKbps === undefined ? -1 : Math.round(input.downloadKbps * 1024 / 8),
      uploadThroughput: input.uploadKbps === undefined ? -1 : Math.round(input.uploadKbps * 1024 / 8),
    })
  } else if (input.action === 'cpu') {
    await client.send('Emulation.setCPUThrottlingRate', { rate: Math.max(input.rate ?? 1, 1) })
  } else if (input.action === 'permissions') {
    if (input.permissions === undefined) fail('INVALID_ARGS', 'permissions requires permissions')
    await dependencies.grantPermissions(input.permissions, input.origin)
  } else if (input.action === 'reset') {
    await dependencies.clearAdaptiveFit(view)
    await Promise.all([
      client.send('Emulation.clearDeviceMetricsOverride').catch(() => ({})),
      client.send('Emulation.setLocaleOverride', { locale: '' }).catch(() => ({})),
      client.send('Emulation.setTimezoneOverride', { timezoneId: '' }).catch(() => ({})),
      client.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => ({})),
      client.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => ({})),
      dependencies.clearPermissions(),
    ])
    applyFixedViewport(view, state, session, STANDARD_VIEWPORT.width, STANDARD_VIEWPORT.height, 1, false)
  } else fail('INVALID_ARGS', `unknown browser_emulate action ${JSON.stringify(input.action)}`)
  return { ok: true, action: 'emulate', viewId: view.viewId, data: asData({ action: input.action }) }
}
