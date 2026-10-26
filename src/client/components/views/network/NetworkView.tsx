import { useState } from 'react'
import css from '../../../panel.module.css'
import type { BrowserNetworkInput, BrowserPanelSnapshot } from '../../../../domain/protocol.ts'

export interface NetworkViewProps {
  snapshot: BrowserPanelSnapshot
  runNetwork: (input: BrowserNetworkInput) => Promise<unknown>
}

export function NetworkView({ snapshot, runNetwork }: NetworkViewProps) {
  const [networkPattern, setNetworkPattern] = useState('*')

  return (
    <div className={css.domainPanel}>
      <div className={css.toolbar}>
        <input
          value={networkPattern}
          placeholder="URL Pattern"
          onChange={event => setNetworkPattern(event.currentTarget.value)}
        />
        <button
          type="button"
          onClick={() => {
            void runNetwork({ action: 'enable', urlPattern: networkPattern || '*', requestStage: 'both' })
          }}
        >
          启用拦截
        </button>
        <button
          type="button"
          onClick={() => {
            void runNetwork({ action: 'disable' })
          }}
        >
          关闭拦截
        </button>
      </div>

      <section>
        <h3>暂停请求</h3>
        {snapshot.pausedRequests?.length ? (
          snapshot.pausedRequests.map(item => (
            <div className={css.item} key={item.requestId}>
              <span>
                {item.method} {item.requestStage} {item.url}
              </span>
              <span>
                <button
                  type="button"
                  onClick={() => {
                    void runNetwork({ action: 'continue', requestId: item.requestId })
                  }}
                >
                  放行
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void runNetwork({ action: 'abort', requestId: item.requestId })
                  }}
                >
                  中止
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void runNetwork({ action: 'body', requestId: item.requestId })
                  }}
                >
                  Body
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void runNetwork({ action: 'replay', requestId: item.requestId })
                  }}
                >
                  Replay
                </button>
              </span>
            </div>
          ))
        ) : (
          <div className={css.empty}>暂无暂停请求</div>
        )}
      </section>

      <section>
        <h3>观察记录</h3>
        {snapshot.network.length === 0 ? (
          <div className={css.empty}>暂无 Network 请求</div>
        ) : (
          <pre>{snapshot.network.map(item => `${item.method} ${item.status ?? '-'} ${item.type} ${item.url}`).join('\n')}</pre>
        )}
      </section>
    </div>
  )
}
