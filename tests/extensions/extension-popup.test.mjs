import assert from 'node:assert/strict'
import test from 'node:test'
import { openExtensionPopup } from '../../src/extensions/extension-popup.ts'

function setup({ width = 700, height = 900, gotoError = false } = {}) {
  const calls = []
  const page = {
    setViewportSize: async size => calls.push(['viewport', size]),
    goto: async url => {
      calls.push(['goto', url])
      if (gotoError) throw new Error('navigation failed')
    },
    locator: () => ({ evaluate: async () => ({ width, height }) }),
    close: async () => calls.push(['close']),
  }
  const view = {
    viewId: 'popup-view',
    viewport: { width: 420, height: 600, contentWidth: 420, fittedWidth: 420, generation: 0 },
    page,
  }
  const session = { activeViewId: 'main-view', extensionPopup: undefined, openingExtensionPopup: undefined }
  const extension = { extensionId: 'abc', name: 'Demo', enabled: true, actionPopup: 'popup.html' }
  const dependencies = {
    session,
    extension,
    createPage: async () => page,
    bindView: () => view,
    syncScreencasts: async () => calls.push(['sync']),
  }
  return { calls, page, view, session, dependencies }
}

test('opens a same-origin popup and clamps measured dimensions', async () => {
  const { calls, view, session, dependencies } = setup()

  const result = await openExtensionPopup(dependencies)

  assert.equal(result.data.popupViewId, 'popup-view')
  assert.equal(result.data.width, 600)
  assert.equal(result.data.height, 720)
  assert.equal(view.viewport.width, 600)
  assert.equal(view.viewport.height, 720)
  assert.equal(view.viewport.generation, 2)
  assert.equal(session.extensionPopup.extensionId, 'abc')
  assert.equal(session.openingExtensionPopup, undefined)
  assert.equal(calls.at(-1)[0], 'sync')
})

test('rejects popup URLs that escape the extension origin', async () => {
  const { dependencies } = setup()
  dependencies.extension.actionPopup = 'https://evil.test/popup.html'

  await assert.rejects(openExtensionPopup(dependencies), error => error.code === 'POLICY_DENIED')
})

test('cleans popup state and closes the page when navigation fails', async () => {
  const { calls, session, dependencies } = setup({ gotoError: true })

  await assert.rejects(openExtensionPopup(dependencies), /navigation failed/)

  assert.equal(session.extensionPopup, undefined)
  assert.equal(session.openingExtensionPopup, undefined)
  assert.deepEqual(calls.filter(([name]) => name === 'close'), [['close']])
})

test('requires an enabled extension popup', async () => {
  const { dependencies } = setup()
  dependencies.extension.enabled = false

  await assert.rejects(openExtensionPopup(dependencies), error => error.code === 'EXTENSION_NOT_LOADED')
})

