import assert from 'node:assert/strict'
import test from 'node:test'
import { createViewState } from '../../src/view/view-state.ts'

test('createViewState initializes page identity and standard viewport state', () => {
  const page = {}
  const view = createViewState('v7', page, 'page')
  assert.equal(view.page, page)
  assert.equal(view.navigationId, 'v7-n0')
  assert.equal(view.documentGeneration, 0)
  assert.equal(view.viewport.width, 1280)
  assert.equal(view.viewport.fitDocumentGeneration, -1)
})

test('createViewState gives extension popups a bounded initial viewport', () => {
  const view = createViewState('v8', {}, 'extension-popup')
  assert.equal(view.viewport.width, 420)
  assert.equal(view.viewport.height, 600)
})

