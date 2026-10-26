import type { Dialog, Page } from 'playwright-core'
import type { ViewState } from '../domain/types.ts'

export function bindPageDialogEvents(page: Page, view: ViewState): void {
  page.on('dialog', dialog => handlePageDialog(view, dialog))
}

export function handlePageDialog(view: ViewState, dialog: Dialog): void {
  const policy = view.dialogPolicy
  if (policy !== undefined) {
    view.dialogPolicy = undefined
    void (policy.accept ? dialog.accept(policy.promptText) : dialog.dismiss())
  } else {
    view.dialog = dialog
  }
}
