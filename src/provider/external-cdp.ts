import { chromium } from 'playwright-core'
import type { Browser, BrowserContext } from 'playwright-core'
import { fail } from '../domain/errors.ts'

export type ExternalCdpConnection = {
  browser: Browser
  context: BrowserContext
}

type ConnectBrowser = (endpoint: string, options: { timeout: number }) => Promise<Browser>

export async function connectExternalCdp(
  endpoint: string,
  timeoutMs: number,
  prepareContext: (context: BrowserContext) => Promise<void>,
  connect: ConnectBrowser = (url, options) => chromium.connectOverCDP(url, options),
): Promise<ExternalCdpConnection> {
  const browser = await connect(endpoint, { timeout: timeoutMs })
  const context = browser.contexts()[0]
  if (context === undefined) {
    await browser.close().catch(() => {})
    fail('PROVIDER_UNAVAILABLE', 'external CDP browser does not expose a default context')
  }
  await prepareContext(context)
  return { browser, context }
}
