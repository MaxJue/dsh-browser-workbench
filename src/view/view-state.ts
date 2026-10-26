import type { Page } from 'playwright-core'
import type { ViewState } from '../domain/types.ts'
import { STANDARD_VIEWPORT } from './viewport.ts'

export function createViewState(viewId: string, page: Page, kind: ViewState['kind']): ViewState {
  const initialViewport = kind === 'extension-popup' ? { width: 420, height: 600 } : STANDARD_VIEWPORT
  return {
    viewId,
    kind,
    page,
    documentGeneration: 0,
    navigationGeneration: 0,
    navigationId: `${viewId}-n0`,
    snapshotGeneration: 0,
    refs: new Map(),
    refCounter: 1,
    console: [],
    network: [],
    viewport: {
      width: initialViewport.width,
      height: initialViewport.height,
      deviceScaleFactor: 1,
      mobile: false,
      generation: 0,
      contentWidth: initialViewport.width,
      fittedWidth: initialViewport.width,
      reflowedElements: 0,
      fitDocumentGeneration: -1,
    },
  }
}
