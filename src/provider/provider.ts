import type { BrowserContext } from 'playwright-core'
import { fail } from '../domain/errors.ts'
import type { SessionState } from '../domain/types.ts'

export function providerState(session: SessionState) {
  return {
    active: session.provider,
    ...(session.providerEndpoint === undefined ? {} : { endpoint: session.providerEndpoint }),
    ...(session.persistentProfile === undefined ? {} : { persistentProfile: session.persistentProfile }),
    providers: [
      { provider: 'disconnected', isolation: 'none', connected: session.provider === 'disconnected' },
      { provider: 'external-cdp', isolation: 'external-browser', connected: session.provider === 'external-cdp' },
    ],
  } as const
}

export function sessionContext(session: SessionState, sharedContext: BrowserContext | undefined): BrowserContext {
  if (session.providerBinding.kind === 'disconnected') {
    fail('BROWSER_NOT_CONNECTED', '请先在 Provider 面板连接已开启远程调试的 Chrome 或 Edge')
  }
  if (session.providerBinding.kind === 'shared-persistent') {
    if (sharedContext === undefined) fail('PROVIDER_UNAVAILABLE', 'shared persistent browser context is not available')
    return sharedContext
  }
  return session.providerBinding.context
}
