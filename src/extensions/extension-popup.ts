import type { Page } from 'playwright-core'
import { fail } from '../domain/errors.ts'
import type { SessionState, ToolOutput, ViewState } from '../domain/types.ts'

type Extension = SessionState['extensionRegistry'][number]

export interface ExtensionPopupDependencies {
  session: SessionState
  extension: Extension
  createPage(session: SessionState, kind: ViewState['kind']): Promise<Page>
  bindView(session: SessionState, page: Page, kind: ViewState['kind']): ViewState
  syncScreencasts(session: SessionState): Promise<void>
}

function asData(value: unknown): ToolOutput['data'] {
  return value as ToolOutput['data']
}

export async function openExtensionPopup(dependencies: ExtensionPopupDependencies): Promise<ToolOutput> {
  const { session, extension } = dependencies
  if (!extension.enabled) fail('EXTENSION_NOT_LOADED', 'the extension must be enabled and loaded before its popup can open')
  if (extension.actionPopup === undefined || extension.actionPopup.trim() === '') fail('EXTENSION_POPUP_UNAVAILABLE', 'the extension does not declare an action popup')
  const base = new URL(`chrome-extension://${extension.extensionId}/`)
  const popupUrl = new URL(extension.actionPopup, base)
  if (popupUrl.origin !== base.origin) fail('POLICY_DENIED', 'extension popup must stay inside its own extension origin')
  if (session.extensionPopup !== undefined) await session.extensionPopup.view.page.close({ runBeforeUnload: false }).catch(() => {})
  session.extensionPopup = undefined
  session.openingExtensionPopup = { extensionId: extension.extensionId, name: extension.name }
  try {
    const page = await dependencies.createPage(session, 'extension-popup')
    const view = dependencies.bindView(session, page, 'extension-popup')
    session.extensionPopup = { extensionId: extension.extensionId, name: extension.name, view }
    await page.setViewportSize({ width: 420, height: 600 })
    view.viewport.width = 420
    view.viewport.height = 600
    view.viewport.contentWidth = 420
    view.viewport.fittedWidth = 420
    view.viewport.generation += 1
    await page.goto(popupUrl.href, { waitUntil: 'domcontentloaded', timeout: 15000 })
    const size = await page.locator('body').evaluate(body => ({ width: Math.ceil(Math.max(body.scrollWidth, body.getBoundingClientRect().width)), height: Math.ceil(Math.max(body.scrollHeight, body.getBoundingClientRect().height)) })).catch(() => ({ width: 420, height: 600 }))
    const width = Math.min(Math.max(size.width, 240), 600)
    const height = Math.min(Math.max(size.height, 180), 720)
    await page.setViewportSize({ width, height })
    view.viewport.width = width
    view.viewport.height = height
    view.viewport.contentWidth = width
    view.viewport.fittedWidth = width
    view.viewport.generation += 1
    await dependencies.syncScreencasts(session)
    return { ok: true, action: 'extensions_open_popup', viewId: session.activeViewId, data: asData({ extensionId: extension.extensionId, name: extension.name, popupViewId: view.viewId, width, height }) }
  } catch (error) {
    const popup = session.extensionPopup
    session.extensionPopup = undefined
    if (popup !== undefined) await popup.view.page.close({ runBeforeUnload: false }).catch(() => {})
    throw error
  } finally {
    session.openingExtensionPopup = undefined
  }
}
