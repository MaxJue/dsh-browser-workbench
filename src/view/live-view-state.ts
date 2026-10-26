import type { SessionState, ViewState } from '../domain/types.ts'
import { STANDARD_VIEWPORT } from './viewport.ts'

export function liveViewState(session: SessionState, view: ViewState) {
  return {
    mode: session.liveView.mode,
    initialized: session.liveView.initialized,
    width: view.viewport.width,
    height: view.viewport.height,
    viewportGeneration: view.viewport.generation,
    reflowed: view.viewport.reflowedElements > 0,
    contentWidth: view.viewport.contentWidth,
    fittedWidth: view.viewport.fittedWidth,
    reflowedElements: view.viewport.reflowedElements,
    changedAt: session.liveView.changedAt,
    standard: STANDARD_VIEWPORT,
    adaptive: session.liveView.adaptiveWidth === undefined || session.liveView.adaptiveHeight === undefined
      ? null
      : { width: session.liveView.adaptiveWidth, height: session.liveView.adaptiveHeight },
  }
}
