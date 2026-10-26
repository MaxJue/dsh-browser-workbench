import { useState } from 'react'
import css from '../../../panel.module.css'
import type { BrowserEmulateInput } from '../../../../domain/protocol.ts'

export interface EmulationViewProps {
  runEmulate: (input: BrowserEmulateInput) => Promise<unknown>
}

export function EmulationView({ runEmulate }: EmulationViewProps) {
  const [viewportWidth, setViewportWidth] = useState('1280')
  const [viewportHeight, setViewportHeight] = useState('720')
  const [locale, setLocale] = useState('zh-CN')
  const [timezone, setTimezone] = useState('Asia/Shanghai')

  return (
    <div className={css.domainPanel}>
      <div className={css.toolbar}>
        <input
          value={viewportWidth}
          inputMode="numeric"
          aria-label="Viewport 宽度"
          onChange={event => setViewportWidth(event.currentTarget.value)}
        />
        <input
          value={viewportHeight}
          inputMode="numeric"
          aria-label="Viewport 高度"
          onChange={event => setViewportHeight(event.currentTarget.value)}
        />
        <button
          type="button"
          onClick={() => {
            void runEmulate({ action: 'viewport', width: Number(viewportWidth), height: Number(viewportHeight) })
          }}
        >
          应用 Viewport
        </button>
        <input
          value={locale}
          placeholder="Locale"
          onChange={event => setLocale(event.currentTarget.value)}
        />
        <button
          type="button"
          onClick={() => {
            void runEmulate({ action: 'locale', locale })
          }}
        >
          应用 Locale
        </button>
        <input
          value={timezone}
          placeholder="Timezone"
          onChange={event => setTimezone(event.currentTarget.value)}
        />
        <button
          type="button"
          onClick={() => {
            void runEmulate({ action: 'timezone', timezoneId: timezone })
          }}
        >
          应用时区
        </button>
        <button
          type="button"
          onClick={() => {
            void runEmulate({ action: 'offline', offline: true })
          }}
        >
          离线
        </button>
        <button
          type="button"
          onClick={() => {
            void runEmulate({ action: 'network', offline: false })
          }}
        >
          恢复网络
        </button>
        <button
          type="button"
          onClick={() => {
            void runEmulate({ action: 'cpu', rate: 4 })
          }}
        >
          CPU ×4
        </button>
        <button
          type="button"
          onClick={() => {
            void runEmulate({ action: 'reset' })
          }}
        >
          全部重置
        </button>
      </div>
    </div>
  )
}
