import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readRuntimeSource() {
  const parts = await Promise.all([
    readFile(new URL('../../src/runtime/runtime-core-services.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/runtime/runtime-panel-actions.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/runtime/runtime-core-foundation.ts', import.meta.url), 'utf8'),
  ])
  return parts.join('\n')
}

test('new sessions start disconnected and launch a dedicated browser on demand', async () => {
  const source = await readRuntimeSource()
  const connector = await readFile(new URL('../../src/provider/external-cdp.ts', import.meta.url), 'utf8')
  assert.match(source, /providerBinding: \{ kind: 'disconnected' \}/)
  assert.match(source, /provider: 'disconnected'/)
  assert.match(source, /connectExternalCdp\(/)
  assert.match(connector, /chromium\.connectOverCDP\(url, options\)/)
  assert.match(source, /ensureAutoProvider\(/)
  assert.match(source, /persistentContext\(session\.sessionId, profileName\)/)
})

test('panel operations keep a recoverable not-connected error and never borrow the shared context', async () => {
  const source = await readRuntimeSource()
  assert.match(source, /code: 'BROWSER_NOT_CONNECTED'/)
  assert.match(source, /provider === 'managed'/)
  const providerAction = source.slice(source.indexOf('private async providerAction'), source.indexOf('private liveViewport'))
  assert.doesNotMatch(providerAction, /sharedPersistentContext\(\)/)
})

test('provider status advertises disconnected, per-session managed, and external CDP modes', async () => {
  const source = await readRuntimeSource()
  const projection = await readFile(new URL('../../src/provider/provider.ts', import.meta.url), 'utf8')
  assert.match(source, /providerState\(session\)/)
  assert.match(projection, /provider: 'disconnected'/)
  assert.match(projection, /provider: 'managed'/)
  assert.match(projection, /provider: 'external-cdp'/)
  assert.doesNotMatch(projection, /provider: 'managed-persistent'/)
})

test('not-connected panel errors explain the automatic per-session browser', async () => {
  const source = await readRuntimeSource()
  assert.match(source, /直接调用浏览器工具会自动启动本 Session 独立的浏览器/)
  assert.doesNotMatch(source, /请先在 Provider 面板连接已开启远程调试的 Chrome 或 Edge。/)
})
