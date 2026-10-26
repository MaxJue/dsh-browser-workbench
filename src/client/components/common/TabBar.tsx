import css from '../../panel.module.css'
import type { BrowserPanelSnapshot } from '../../../domain/protocol.ts'

export interface TabBarProps {
  tabs: BrowserPanelSnapshot['tabs']
  onSelectTab: (viewId: string) => void
  onCloseTab: (viewId: string) => void
  onNewTab: () => void
}

export function TabBar({ tabs, onSelectTab, onCloseTab, onNewTab }: TabBarProps) {
  return (
    <div className={css.tabBar}>
      <div className={css.tabList} role="tablist" aria-label="浏览器标签">
        {tabs.map(item => (
          <div className={css.tab} data-active={item.active || undefined} key={item.viewId} title={`${item.title || '新标签页'}\n${item.url}`}>
            <button
              type="button"
              role="tab"
              aria-selected={item.active}
              className={css.tabSelect}
              onClick={() => onSelectTab(item.viewId)}
            >
              <span>{item.title || (item.url === 'about:blank' ? '新标签页' : item.url)}</span>
            </button>
            <button
              type="button"
              className={css.tabClose}
              aria-label={`关闭标签 ${item.title || item.url}`}
              onClick={() => onCloseTab(item.viewId)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className={css.newTab} aria-label="新建浏览器标签" onClick={onNewTab}>
        +
      </button>
    </div>
  )
}
