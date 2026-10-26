import assert from 'node:assert/strict'
import test from 'node:test'
import {
  debuggerActions,
  diagnoseActions,
  emulateActions,
  evaluateActions,
  extensionChoices,
  extensionActions,
  liveViewActions,
  networkActions,
  panelTabActions,
  panelViews,
  profileActions,
  providerChoices,
  providerActions,
  recorderActions,
  splitViewActions,
} from '../../src/application/tool-metadata.ts'

const actionSets = {
  debuggerActions,
  diagnoseActions,
  emulateActions,
  evaluateActions,
  extensionChoices,
  extensionActions,
  liveViewActions,
  networkActions,
  panelTabActions,
  panelViews,
  profileActions,
  providerChoices,
  providerActions,
  recorderActions,
  splitViewActions,
}

test('every tool action set is non-empty and contains no duplicate values', () => {
  for (const [name, actions] of Object.entries(actionSets)) {
    assert.ok(actions.length > 0, `${name} should not be empty`)
    assert.equal(new Set(actions).size, actions.length, `${name} should not contain duplicates`)
  }
})

test('critical recovery and diagnostic actions remain available', () => {
  assert.ok(debuggerActions.includes('resume'))
  assert.ok(networkActions.includes('continue'))
  assert.ok(diagnoseActions.includes('checkpoint'))
  assert.ok(recorderActions.includes('complete'))
  assert.ok(panelViews.includes('diagnostic'))
  assert.deepEqual(providerChoices, ['managed', 'external-cdp'])
  assert.deepEqual(extensionChoices, ['list'])
})
