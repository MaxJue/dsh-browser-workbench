import { useState } from 'react'
import css from '../../../panel.module.css'
import type { BrowserPanelSnapshot, BrowserProviderInput } from '../../../../domain/protocol.ts'
import { DEFAULT_CDP_ENDPOINT, connectionErrorMessage, normalizeCdpEndpoint } from '../../../connect-guide.ts'

export interface ProviderViewProps {
  snapshot: BrowserPanelSnapshot
  runProvider: (input: BrowserProviderInput) => Promise<unknown>
  error?: string
  setError: (error?: string) => void
}

export function ProviderView({ snapshot, runProvider, error, setError }: ProviderViewProps) {
  const [externalEndpoint, setExternalEndpoint] = useState(DEFAULT_CDP_ENDPOINT)
  const [connectionBusy, setConnectionBusy] = useState(false)

  const isConnected = snapshot.capabilities?.provider === 'external-cdp' && snapshot.available

  const connectBrowser = async () => {
    setConnectionBusy(true)
    setError(undefined)
    try {
      const endpoint = normalizeCdpEndpoint(externalEndpoint)
      setExternalEndpoint(endpoint)
      await runProvider({ action: 'connect', provider: 'external-cdp', endpoint })
    } catch (cause) {
      setError(connectionErrorMessage(cause))
    } finally {
      setConnectionBusy(false)
    }
  }

  return (
    <div className={css.domainPanel}>
      {isConnected ? (
        <>
          <div className={css.connectStatus} data-connected="true">
            <strong>已连接浏览器</strong>
            <span>
              {snapshot.capabilities?.provider} · {snapshot.tabs.length} 个标签页
            </span>
          </div>
          <div className={css.toolbar}>
            <button
              type="button"
              onClick={() => {
                void runProvider({ action: 'disconnect' })
              }}
            >
              断开连接
            </button>
          </div>
          <div className={css.message}>断开只释放 DSH 的 CDP 连接，不会关闭 Chrome。</div>
        </>
      ) : (
        <div className={css.connectGuide}>
          <div className={css.connectStatus}>
            <strong>连接现有 Chrome</strong>
            <span>使用你已经打开的 Chrome 或 Edge，不会下载或托管新的浏览器。</span>
          </div>
          <label className={css.connectEndpoint}>
            <span>远程调试地址</span>
            <input
              value={externalEndpoint}
              inputMode="url"
              placeholder={DEFAULT_CDP_ENDPOINT}
              aria-label="远程调试地址"
              onChange={event => setExternalEndpoint(event.currentTarget.value)}
            />
          </label>
          <button
            className={css.connectPrimary}
            type="button"
            disabled={connectionBusy}
            onClick={() => {
              void connectBrowser()
            }}
          >
            {connectionBusy ? '正在连接…' : '连接浏览器'}
          </button>
          <ol className={css.connectSteps}>
            <li>关闭需要接入的 Chrome 实例。</li>
            <li>
              用 <code>--remote-debugging-port=9222</code> 启动 Chrome。
            </li>
            <li>回到这里，点击“连接浏览器”。</li>
          </ol>
          {error !== undefined && (
            <div className={css.connectError} role="alert">
              {connectionErrorMessage(error)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
