import css from '../../../panel.module.css'
import type { BrowserPanelSnapshot } from '../../../../domain/protocol.ts'

export interface ConsoleViewProps {
  consoleMessages: BrowserPanelSnapshot['console']
}

export function ConsoleView({ consoleMessages }: ConsoleViewProps) {
  if (consoleMessages.length === 0) {
    return <div className={css.empty}>暂无 Console 消息</div>
  }

  return (
    <pre>
      {consoleMessages.map(item => `[${item.level}] ${item.text}`).join('\n')}
    </pre>
  )
}
