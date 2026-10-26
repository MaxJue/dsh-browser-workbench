import assert from 'node:assert/strict'
import test from 'node:test'
import { Config } from '../../src/application/config.ts'

test('config schema applies documented defaults', () => {
  const config = Config({})
  assert.equal(config.headless, true)
  assert.deepEqual(config.proxy, { mode: 'system', server: '', bypass: '', username: '', password: '' })
  assert.equal(config.chromiumDownloadSource, 'auto')
  assert.equal(config.chromiumDownloadTimeoutMs, 300000)
  assert.equal(config.toolRegistrationMode, 'global')
  assert.equal(config.providerMode, 'auto')
  assert.equal(config.subagentInteractive, false)
})

test('config schema enforces enums and numeric floors', () => {
  assert.throws(() => Config({ chromiumDownloadSource: 'mirror' }))
  assert.throws(() => Config({ toolRegistrationMode: 'per-session' }))
  assert.throws(() => Config({ providerMode: 'shared' }))
  assert.throws(() => Config({ proxy: { mode: 'tunnel' } }))
  assert.throws(() => Config({ chromiumDownloadTimeoutMs: 999 }))
  assert.throws(() => Config({ maxOutputChars: 999 }))
  assert.equal(Config({ chromiumDownloadSource: 'npmmirror', chromiumDownloadTimeoutMs: 1000 }).chromiumDownloadSource, 'npmmirror')
})
