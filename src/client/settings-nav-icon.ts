import type { Context } from '@deepseek-ai/cordis'

/**
 * DSH 设置面板里，`settings.section` 只向宿主投影 `id` / `order` / `label`，
 * 导航行图标由宿主的 `navIcon(id)` 写死，未知 id 一律显示齿轮。
 *
 * 宿主没有图标接口，这里按社区插件的既有解法自证一行：用 label 文本认领
 * 自己那条导航行，打上标记，再用一张 mask 把宿主齿轮换成浏览器窗口图形。
 * 只改动本插件自己那一行，不碰宿主的其它结构。
 */
const NAV_ICON_MARKER = 'data-dsh-browser-nav-icon'
const NAV_ROW_SELECTOR = '[role="dialog"] nav button'

/** 与设置分区标题图标（`WorkbenchIcon`）同形，供 CSS mask 使用。 */
const MASK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
  + '<rect x="3" y="4" width="18" height="16" rx="2.5"/>'
  + '<path d="M3 9h18"/>'
  + '<circle cx="6.2" cy="6.5" r="0.9" fill="#000" stroke="none"/>'
  + '</svg>'

const MASK_URL = `data:image/svg+xml,${encodeURIComponent(MASK_SVG)}`

const NAV_ICON_CSS = [
  `[${NAV_ICON_MARKER}] > svg { display: none; }`,
  `[${NAV_ICON_MARKER}]::before {`,
  "  content: '';",
  '  flex: none;',
  '  width: 16px;',
  '  height: 16px;',
  '  background-color: currentColor;',
  `  -webkit-mask-image: url("${MASK_URL}");`,
  `  mask-image: url("${MASK_URL}");`,
  '  -webkit-mask-repeat: no-repeat;',
  '  mask-repeat: no-repeat;',
  '  -webkit-mask-position: center;',
  '  mask-position: center;',
  '  -webkit-mask-size: 16px 16px;',
  '  mask-size: 16px 16px;',
  '}',
].join('\n')

function isOwnNavRow(rowText: string | null, wanted: string): boolean {
  const label = wanted.trim()
  if (label === '') return false
  return (rowText ?? '').trim() === label
}

/** 认领设置导航里属于本插件的那一行，把宿主齿轮换成工作台图标。 */
export function installSettingsNavIcon(ctx: Context, resolveLabel: () => string): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-browser-workbench'
    style.dataset.pluginCss = 'dsh-browser-workbench/settings-nav-icon'
    style.textContent = NAV_ICON_CSS
    document.head.appendChild(style)

    let disposed = false
    let scheduled = false
    const sync = () => {
      scheduled = false
      if (disposed) return
      const wanted = resolveLabel()
      for (const row of document.querySelectorAll<HTMLElement>(NAV_ROW_SELECTOR)) {
        if (isOwnNavRow(row.textContent, wanted)) row.setAttribute(NAV_ICON_MARKER, '')
        else row.removeAttribute(NAV_ICON_MARKER)
      }
    }
    const schedule = () => {
      if (scheduled || disposed) return
      scheduled = true
      queueMicrotask(sync)
    }

    sync()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    return () => {
      disposed = true
      observer.disconnect()
      style.remove()
      for (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) row.removeAttribute(NAV_ICON_MARKER)
    }
  }, 'browser scope settings nav icon')
}
