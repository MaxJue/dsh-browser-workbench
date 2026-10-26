import type { SessionState, ViewState } from '../domain/types.ts'

export const ADAPTIVE_REFLOW_ATTRIBUTE = 'data-dsh-browser-tools-adaptive-reflow'

export async function clearAdaptiveFit(view: ViewState): Promise<void> {
  const removed = await view.page.evaluate(attribute => {
    const style = document.querySelector(`style[${attribute}]`)
    const elements = document.querySelectorAll(`[${attribute}]`)
    const changed = style !== null || elements.length > 0
    style?.remove()
    elements.forEach(element => element.removeAttribute(attribute))
    return changed
  }, ADAPTIVE_REFLOW_ATTRIBUTE).catch(() => false)
  const changed = removed || view.viewport.reflowedElements > 0
  view.viewport.contentWidth = view.viewport.width
  view.viewport.fittedWidth = view.viewport.width
  view.viewport.reflowedElements = 0
  view.viewport.fitDocumentGeneration = -1
  if (!changed) return
  view.viewport.generation += 1
  if (view.cdp !== undefined) view.cdp.latestFrame = undefined
}

export async function applyAdaptiveFit(
  _session: SessionState,
  view: ViewState,
  restartScreencast: (view: ViewState) => Promise<void>,
): Promise<void> {
  const result = await view.page.evaluate(({ attribute, viewportWidth }) => {
    document.querySelector(`style[${attribute}]`)?.remove()
    document.querySelectorAll(`[${attribute}]`).forEach(element => element.removeAttribute(attribute))
    const root = document.documentElement
    if (root === null) return { contentWidth: viewportWidth, fittedWidth: viewportWidth, reflowedElements: 0 }
    const body = document.body
    const contentWidth = Math.max(root.clientWidth, root.scrollWidth, body?.scrollWidth ?? 0, viewportWidth)
    if (contentWidth <= viewportWidth + 1) {
      return { contentWidth, fittedWidth: contentWidth, reflowedElements: 0 }
    }

    const allowed = new Set(['DIV', 'MAIN', 'SECTION', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'ARTICLE', 'FORM'])
    const style = document.createElement('style')
    style.setAttribute(attribute, '')
    style.textContent = `
      html, body {
        min-width: 0 !important;
        max-width: 100% !important;
        overflow-x: hidden !important;
      }
      [${attribute}="normal"] {
        min-width: 0 !important;
        max-width: 100% !important;
        width: 100% !important;
        box-sizing: border-box !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
      }
      [${attribute}="absolute"] {
        min-width: 0 !important;
        max-width: 100% !important;
        left: 0 !important;
        right: 0 !important;
        width: auto !important;
        box-sizing: border-box !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
      }
    `
    ;(document.head ?? root).append(style)

    let previousWidth = contentWidth
    let reflowedElements = 0
    for (let pass = 0; pass < 3; pass += 1) {
      const candidates = [...document.querySelectorAll('body *')].filter(element => {
        if (!(element instanceof HTMLElement) || !allowed.has(element.tagName) || element.hasAttribute(attribute)) return false
        const rect = element.getBoundingClientRect()
        const computed = getComputedStyle(element)
        if (computed.display === 'none' || rect.width <= 0) return false
        const minWidth = Number.parseFloat(computed.minWidth)
        return (Number.isFinite(minWidth) && minWidth > viewportWidth + 1)
          || rect.width > viewportWidth + 1
          || (rect.right > viewportWidth + 1 && rect.width > viewportWidth * 0.75)
      })
      const candidateSet = new Set(candidates)
      const outermost = candidates.filter(element => {
        let parent = element.parentElement
        while (parent !== null) {
          if (candidateSet.has(parent)) return false
          parent = parent.parentElement
        }
        return true
      })
      if (outermost.length === 0) break
      for (const element of outermost) {
        const position = getComputedStyle(element).position
        element.setAttribute(attribute, position === 'absolute' || position === 'fixed' ? 'absolute' : 'normal')
      }
      reflowedElements += outermost.length
      root.getBoundingClientRect()
      const currentWidth = Math.max(root.clientWidth, root.scrollWidth, body?.scrollWidth ?? 0, viewportWidth)
      if (currentWidth >= previousWidth - 1) break
      previousWidth = currentWidth
      if (currentWidth <= viewportWidth + 1) break
    }
    const fittedWidth = Math.max(root.clientWidth, root.scrollWidth, body?.scrollWidth ?? 0, viewportWidth)
    return { contentWidth, fittedWidth, reflowedElements }
  }, { attribute: ADAPTIVE_REFLOW_ATTRIBUTE, viewportWidth: view.viewport.width }).catch(() => undefined)
  if (result === undefined) return
  const changed = view.viewport.contentWidth !== result.contentWidth
    || view.viewport.fittedWidth !== result.fittedWidth
    || view.viewport.reflowedElements !== result.reflowedElements
  view.viewport.contentWidth = result.contentWidth
  view.viewport.fittedWidth = result.fittedWidth
  view.viewport.reflowedElements = result.reflowedElements
  view.viewport.fitDocumentGeneration = view.documentGeneration
  if (!changed) return
  view.viewport.generation += 1
  if (view.cdp !== undefined) {
    view.cdp.latestFrame = undefined
    if (view.cdp.screencastStarted) await restartScreencast(view)
  }
}
