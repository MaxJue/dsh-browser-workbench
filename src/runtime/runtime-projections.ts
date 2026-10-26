import type { SessionState, ViewState } from '../domain/types.ts'

export function visualCaptureState(session: SessionState) {
  const states = [...session.views.values()].map(view => view.cdp).filter((state): state is NonNullable<ViewState['cdp']> => state !== undefined)
  return {
    activeViewCount: states.filter(state => state.screencastConsumers.size > 0).length,
    startedViewCount: states.filter(state => state.screencastStarted).length,
    liveViewConsumerCount: states.filter(state => state.screencastConsumers.has('live-view')).length,
    recorderConsumerCount: states.filter(state => state.screencastConsumers.has('recorder')).length,
  }
}

export function debuggerState(view: ViewState) {
  const state = view.cdp
  return {
    attached: state?.debuggerEnabled ?? false,
    paused: state?.paused ?? false,
    ...(state?.reason === undefined ? {} : { reason: state.reason }),
    callFrames: state?.callFrames ?? [],
    scripts: [...(state?.scripts.values() ?? [])].filter(item => item.url !== '').slice(-500),
    breakpoints: [...(state?.breakpoints.values() ?? [])],
  }
}

export function safeRemoteResult(value: unknown, maxOutputChars: number): unknown {
  const seen = new WeakSet<object>()
  const json = JSON.stringify(value, (key, item) => {
    if (/token|secret|password|cookie|authorization/i.test(key)) return '[REDACTED]'
    if (typeof item === 'object' && item !== null) {
      if (seen.has(item)) return '[Circular]'
      seen.add(item)
    }
    return item
  })
  if (json === undefined) return null
  return json.length > maxOutputChars ? `${json.slice(0, maxOutputChars)}…` : JSON.parse(json)
}
