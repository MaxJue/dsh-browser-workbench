import assert from 'node:assert/strict'
import test from 'node:test'
import { projectExtensionState } from '../../src/extensions/extension-state.ts'

const extension = (overrides = {}) => ({
  extensionId: 'a'.repeat(32),
  name: 'Sample',
  version: '1.0.0',
  enabled: true,
  installedAt: 1,
  sourceUrl: 'https://example.test/extension',
  path: '/extensions/sample',
  ...overrides,
})

test('extension projection marks registered extensions pending when they are not loaded', () => {
  const [summary] = projectExtensionState([extension()], [])
  assert.equal(summary.loaded, false)
  assert.equal(summary.pendingRestart, true)
  assert.equal(summary.enabled, true)
})

test('extension projection compares loaded identity and includes unregistered loaded extensions', () => {
  const registered = extension()
  const staleLoaded = extension({ version: '0.9.0' })
  const unregistered = extension({ extensionId: 'b'.repeat(32), enabled: true })
  const summaries = projectExtensionState([registered], [staleLoaded, unregistered])

  assert.equal(summaries[0].loaded, true)
  assert.equal(summaries[0].pendingRestart, true)
  assert.deepEqual(summaries[1], {
    extensionId: unregistered.extensionId,
    name: unregistered.name,
    version: unregistered.version,
    enabled: false,
    loaded: true,
    pendingRestart: true,
    installedAt: unregistered.installedAt,
    sourceUrl: unregistered.sourceUrl,
  })
})

