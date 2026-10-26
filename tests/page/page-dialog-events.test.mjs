import assert from 'node:assert/strict'
import test from 'node:test'
import { bindPageDialogEvents, handlePageDialog } from '../../src/page/page-dialog-events.ts'

function dialogFixture() {
  const calls = []
  return {
    dialog: {
      accept: async promptText => calls.push(['accept', promptText]),
      dismiss: async () => calls.push(['dismiss']),
    },
    calls,
  }
}

test('page dialog policy accepts once and clears itself', async () => {
  const { dialog, calls } = dialogFixture()
  const view = { dialogPolicy: { accept: true, promptText: 'hello' }, dialog: undefined }

  handlePageDialog(view, dialog)
  await Promise.resolve()

  assert.equal(view.dialogPolicy, undefined)
  assert.equal(view.dialog, undefined)
  assert.deepEqual(calls, [['accept', 'hello']])
})

test('page dialog policy dismisses once', async () => {
  const { dialog, calls } = dialogFixture()
  const view = { dialogPolicy: { accept: false }, dialog: undefined }

  handlePageDialog(view, dialog)
  await Promise.resolve()

  assert.deepEqual(calls, [['dismiss']])
})

test('page dialog without policy remains available to the explicit handler', () => {
  const { dialog } = dialogFixture()
  const handlers = new Map()
  const page = { on: (event, listener) => handlers.set(event, listener) }
  const view = { dialogPolicy: undefined, dialog: undefined }

  bindPageDialogEvents(page, view)
  handlers.get('dialog')(dialog)

  assert.equal(view.dialog, dialog)
})

