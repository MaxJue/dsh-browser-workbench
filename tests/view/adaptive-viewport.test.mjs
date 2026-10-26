import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAdaptiveFit, clearAdaptiveFit } from '../../src/view/adaptive-viewport.ts'

test('clearAdaptiveFit resets reflow metadata and invalidates the latest frame', async () => {
  const evaluations = []
  const view = {
    page: { evaluate: async (...args) => { evaluations.push(args); return true } },
    viewport: { width: 640, contentWidth: 900, fittedWidth: 800, reflowedElements: 2, fitDocumentGeneration: 4, generation: 3 },
    cdp: { latestFrame: { data: 'stale' } },
  }

  await clearAdaptiveFit(view)

  assert.equal(evaluations.length, 1)
  assert.equal(view.viewport.contentWidth, 640)
  assert.equal(view.viewport.fittedWidth, 640)
  assert.equal(view.viewport.reflowedElements, 0)
  assert.equal(view.viewport.fitDocumentGeneration, -1)
  assert.equal(view.viewport.generation, 4)
  assert.equal(view.cdp.latestFrame, undefined)
})

test('clearAdaptiveFit avoids a generation change when no layout was applied', async () => {
  const view = {
    page: { evaluate: async () => false },
    viewport: { width: 640, contentWidth: 640, fittedWidth: 640, reflowedElements: 0, fitDocumentGeneration: 4, generation: 3 },
    cdp: { latestFrame: { data: 'fresh' } },
  }

  await clearAdaptiveFit(view)

  assert.equal(view.viewport.generation, 3)
  assert.deepEqual(view.cdp.latestFrame, { data: 'fresh' })
})

test('applyAdaptiveFit records layout results and restarts an active screencast after changes', async () => {
  const restarted = []
  const view = {
    page: { evaluate: async () => ({ contentWidth: 1200, fittedWidth: 640, reflowedElements: 2 }) },
    viewport: { width: 640, contentWidth: 1200, fittedWidth: 800, reflowedElements: 1, fitDocumentGeneration: -1, generation: 3 },
    documentGeneration: 5,
    cdp: { latestFrame: { data: 'stale' }, screencastStarted: true },
  }

  await applyAdaptiveFit({}, view, async current => restarted.push(current))

  assert.equal(view.viewport.contentWidth, 1200)
  assert.equal(view.viewport.fittedWidth, 640)
  assert.equal(view.viewport.reflowedElements, 2)
  assert.equal(view.viewport.fitDocumentGeneration, 5)
  assert.equal(view.viewport.generation, 4)
  assert.equal(view.cdp.latestFrame, undefined)
  assert.deepEqual(restarted, [view])
})

test('applyAdaptiveFit leaves state untouched when page evaluation fails', async () => {
  const view = {
    page: { evaluate: async () => { throw new Error('page closed') } },
    viewport: { width: 640, contentWidth: 700, fittedWidth: 650, reflowedElements: 1, fitDocumentGeneration: 2, generation: 3 },
    documentGeneration: 5,
  }

  await applyAdaptiveFit({}, view, async () => assert.fail('must not restart'))

  assert.equal(view.viewport.contentWidth, 700)
  assert.equal(view.viewport.generation, 3)
})

