import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readRuntimeSource() {
  const parts = await Promise.all([
    readFile(new URL('../../src/runtime/runtime-core-services.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/runtime/runtime-panel-actions.ts', import.meta.url), 'utf8'),
  ])
  return parts.join('\n')
}

test('new sessions stay disconnected until an explicit CDP connection', async () => {
  const source = await readRuntimeSource()
  const connector = await readFile(new URL('../../src/provider/external-cdp.ts', import.meta.url), 'utf8')
  assert.match(source, /providerBinding: \{ kind: 'disconnected' \}/)
  assert.match(source, /provider: 'disconnected'/)
  assert.match(source, /connectExternalCdp\(/)
  assert.match(connector, /chromium\.connectOverCDP\(url, options\)/)
})

test('panel operations keep a recoverable not-connected error and no managed fallback', async () => {
  const source = await readRuntimeSource()
  assert.match(source, /code: 'BROWSER_NOT_CONNECTED'/)
  assert.match(source, /UNSUPPORTED_PROVIDER.*只支持连接已开启远程调试/)
  const providerAction = source.slice(source.indexOf('private async providerAction'), source.indexOf('private liveViewport'))
  assert.doesNotMatch(providerAction, /sharedPersistentContext\(\)/)
})

test('provider status only advertises disconnected and external CDP modes', async () => {
  const source = await readRuntimeSource()
  const projection = await readFile(new URL('../../src/provider/provider.ts', import.meta.url), 'utf8')
  assert.match(source, /providerState\(session\)/)
  assert.match(projection, /provider: 'disconnected'/)
  assert.match(projection, /provider: 'external-cdp'/)
  assert.doesNotMatch(projection, /provider: 'managed(?:-persistent)?'/)
})

test('not-connected panel errors explain the external CDP connection path', async () => {
  const source = await readRuntimeSource()
  assert.doesNotMatch(source, /当前会话尚未创建浏览器/)
  assert.match(source, /请先在 Provider 面板连接已开启远程调试的 Chrome 或 Edge。/)
})
