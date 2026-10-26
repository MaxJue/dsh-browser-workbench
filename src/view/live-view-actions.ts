import type { BrowserLiveViewInput } from '../domain/protocol.ts'
import type { SessionState } from '../domain/types.ts'
import { fail } from '../domain/errors.ts'
import { normalizeAdaptiveViewport, STANDARD_VIEWPORT } from './viewport.ts'

export type LiveViewMutation = 'initialize' | 'resize' | 'standard' | 'adaptive'

export function mutateLiveViewState(session: SessionState, input: BrowserLiveViewInput): { mutation: LiveViewMutation; changed: boolean; adaptiveUnavailable?: boolean } {
  if (input.action === 'initialize') {
    if (!session.liveView.initialized) {
      session.liveView.mode = input.mode ?? 'adaptive'
      session.liveView.initialized = true
      session.liveView.changedAt = Date.now()
    }
    if (input.width !== undefined && input.height !== undefined) {
      const viewport = normalizeAdaptiveViewport(input.width, input.height)
      session.liveView.adaptiveWidth = viewport.width
      session.liveView.adaptiveHeight = viewport.height
    }
    return { mutation: 'initialize', changed: false }
  }

  if (input.action === 'resize') {
    if (input.width === undefined || input.height === undefined) fail('INVALID_ARGS', 'live view resize requires width and height')
    const viewport = normalizeAdaptiveViewport(input.width, input.height)
    const changed = session.liveView.adaptiveWidth !== viewport.width || session.liveView.adaptiveHeight !== viewport.height
    session.liveView.adaptiveWidth = viewport.width
    session.liveView.adaptiveHeight = viewport.height
    if (changed && session.liveView.mode === 'adaptive') session.liveView.changedAt = Date.now()
    return { mutation: 'resize', changed }
  }

  if (input.action === 'standard') {
    const changed = session.liveView.mode !== 'standard'
    session.liveView.mode = 'standard'
    session.liveView.initialized = true
    session.liveView.fixedWidth = STANDARD_VIEWPORT.width
    session.liveView.fixedHeight = STANDARD_VIEWPORT.height
    session.liveView.changedAt = Date.now()
    return { mutation: 'standard', changed }
  }

  if (input.action === 'adaptive') {
    if (input.width !== undefined && input.height !== undefined) {
      const viewport = normalizeAdaptiveViewport(input.width, input.height)
      session.liveView.adaptiveWidth = viewport.width
      session.liveView.adaptiveHeight = viewport.height
    }
    if (session.liveView.adaptiveWidth === undefined || session.liveView.adaptiveHeight === undefined) {
      return { mutation: 'adaptive', changed: false, adaptiveUnavailable: true }
    }
    const changed = session.liveView.mode !== 'adaptive'
    session.liveView.mode = 'adaptive'
    session.liveView.initialized = true
    session.liveView.changedAt = Date.now()
    return { mutation: 'adaptive', changed }
  }

  fail('INVALID_ARGS', `unknown browser_live_view action ${JSON.stringify(input.action)}`)
}
