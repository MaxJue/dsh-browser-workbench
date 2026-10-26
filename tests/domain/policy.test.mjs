import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { assertCdpEndpoint, assertUrlAllowed, redactUrl, resolveConfig } from '../../src/domain/policy.ts'

test('resolveConfig applies defaults and normalizes configured values', () => {
  const config = resolveConfig({
    allowedOrigins: ['https://example.com/path'],
    uploadRoots: ['.'],
    toolRegistrationMode: 'global',
    sessionController: { excludeTools: ['browser_click'] },
  })

  assert.equal(config.headless, true)
  assert.equal(config.allowedOrigins.has('https://example.com'), true)
  assert.equal(config.toolRegistrationMode, 'global')
  assert.deepEqual(config.sessionController.excludeTools, ['browser_click'])
  assert.equal(config.proxy.mode, 'system')
})

test('custom proxy rejects embedded credentials and unsupported protocols', () => {
  assert.throws(() => resolveConfig({ proxy: { mode: 'custom', server: 'https://user:pass@example.com' } }), /credentials/)
  assert.throws(() => resolveConfig({ proxy: { mode: 'custom', server: 'ftp://proxy.example.com' } }), /not supported/)
})

test('proxy modes normalize servers and reject silent custom fields', () => {
  const custom = resolveConfig({ proxy: { mode: 'custom', server: 'socks5://proxy.example.com:1080/', bypass: 'localhost', username: 'u', password: 'p' } })
  assert.deepEqual(custom.proxy, { mode: 'custom', server: 'socks5://proxy.example.com:1080', bypass: 'localhost', username: 'u', password: 'p' })

  assert.deepEqual(resolveConfig({ proxy: { mode: 'direct' } }).proxy, { mode: 'direct' })
  assert.throws(() => resolveConfig({ proxy: { mode: 'direct', server: 'http://proxy.example.com' } }), /does not accept custom proxy fields/)
  assert.throws(() => resolveConfig({ proxy: { mode: 'system', username: 'u' } }), /does not accept custom proxy fields/)
  assert.throws(() => resolveConfig({ proxy: { mode: 'custom' } }), /requires proxy.server/)
  assert.throws(() => resolveConfig({ proxy: { mode: 'custom', server: 'not a url' } }), /server is invalid/)
  assert.throws(() => resolveConfig({ proxy: { mode: 'custom', server: 'http://proxy.example.com/path' } }), /must not include a path/)
  assert.throws(() => resolveConfig({ proxy: { mode: 'custom', server: 'http://proxy.example.com?x=1' } }), /must not include a path/)
})

test('managed launch settings are normalized for the isolated browser path', () => {
  const config = resolveConfig({ executablePath: 'chrome/relative.exe', headless: false })
  assert.equal(config.headless, false)
  assert.equal(config.executablePath, resolve('chrome/relative.exe'))
  assert.equal(config.chromiumDownloadSource, 'auto')
  assert.equal(config.chromiumDownloadTimeoutMs, 300000)
  assert.equal(resolveConfig({}).executablePath, undefined)
})


test('URL policies reject credentials, disallowed origins and disabled loopback', () => {
  const config = resolveConfig({ allowedOrigins: ['https://example.com'], allowLoopback: false })
  assert.equal(assertUrlAllowed(config, 'https://example.com/path').origin, 'https://example.com')
  assert.throws(() => assertUrlAllowed(config, 'https://user:pass@example.com'), /credentials/)
  assert.throws(() => assertUrlAllowed(config, 'https://other.example'), /not allowed/)
  assert.throws(() => assertUrlAllowed(resolveConfig({ allowLoopback: false }), 'http://localhost'), /loopback/)
})

test('CDP endpoints allow supported protocols but reject unsafe forms', () => {
  assert.equal(assertCdpEndpoint('ws://127.0.0.1:9222/devtools').protocol, 'ws:')
  assert.throws(() => assertCdpEndpoint('file:///tmp/devtools'), /not allowed/)
  assert.throws(() => assertCdpEndpoint('https://user:pass@example.com'), /credentials/)
})

test('redactUrl masks sensitive query values while preserving ordinary parameters', () => {
  assert.equal(redactUrl('https://example.com/?page=2&access_token=secret'), 'https://example.com/?page=2&access_token=%5BREDACTED%5D')
})
