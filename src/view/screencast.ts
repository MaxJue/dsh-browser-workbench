import type { ViewState } from '../domain/types.ts'
import { rawCdp } from '../cdp/cdp-raw.ts'

export type ScreencastConsumer = 'live-view' | 'recorder'

export async function startScreencast(view: ViewState, consumer: ScreencastConsumer): Promise<void> {
  const state = view.cdp
  if (state === undefined) return
  state.screencastConsumers.add(consumer)
  if (state.screencastStarted) return
  const client = rawCdp(state.session)
  await client.send('Page.enable')
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1920, maxHeight: 1200, everyNthFrame: 1 })
  state.screencastStarted = true
}

export async function releaseScreencast(view: ViewState, consumer: ScreencastConsumer): Promise<void> {
  const state = view.cdp
  if (state === undefined) return
  state.screencastConsumers.delete(consumer)
  if (!state.screencastStarted || state.screencastConsumers.size > 0) return
  await rawCdp(state.session).send('Page.stopScreencast').catch(() => {})
  state.screencastStarted = false
  state.latestFrame = undefined
}

export async function restartScreencast(view: ViewState): Promise<ScreencastConsumer | undefined> {
  const state = view.cdp
  if (state === undefined || !state.screencastStarted || state.screencastConsumers.size === 0) return undefined
  await rawCdp(state.session).send('Page.stopScreencast').catch(() => {})
  state.screencastStarted = false
  const consumer = state.screencastConsumers.values().next().value as ScreencastConsumer | undefined
  if (consumer !== undefined) await startScreencast(view, consumer)
  return consumer
}

export async function forceStopScreencast(view: ViewState): Promise<void> {
  const state = view.cdp
  if (state === undefined) return
  state.screencastConsumers.clear()
  if (state.screencastStarted) await rawCdp(state.session).send('Page.stopScreencast').catch(() => {})
  state.screencastStarted = false
  state.latestFrame = undefined
}
