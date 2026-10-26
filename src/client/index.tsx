import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { BrowserPanelView } from '../domain/protocol.ts'
import { createPanelController } from './panel-controller.ts'
import { createPort } from './port.ts'
import { installSettingsNavIcon } from './settings-nav-icon.ts'
import { BrowserGlyph } from './components/common/BrowserGlyph.tsx'
import { BrowserPanel } from './components/panel/BrowserPanel.tsx'
import { BrowserSettingsSection } from './components/settings/BrowserSettingsSection.tsx'

const BROWSER_TAB_ID = 'dsh-browser-workbench/browser'
const BROWSER_TAB_KIND = 'dsh-browser-workbench.browser'
/** 设置分区标题，同时用于认领导航行。 */
const BROWSER_SECTION_LABEL = '浏览器'

interface CompatibleSidebarRightTab {
  id: string
  kind: string
}

interface CompatibleSidebarRight {
  openTab(kind: string, options?: { params?: BrowserTabParams }): void
  close(tabId: string): void
  active(): CompatibleSidebarRightTab | undefined
}

/**
 * 右侧栏「开始」页上的入口卡。
 *
 * 宿主只在这里收 `title()`/`description()`（都是惰性文本）和可选图标组件，点击后按
 * `kind` 打开对应的标签页，所以面板的入口完全由这段声明决定。
 */
interface CompatibleSidebarRightGuideEntry {
  id: string
  order?: number
  title(): string
  description?(): string
  icon?: ComponentType<{ size?: number; className?: string }>
}

interface CompatibleSidebarRightTabs {
  register(definition: {
    id: string
    kind: string
    priority?: 'extension' | 'builtin' | 'fallback'
    title(address: string): string
    guide?: CompatibleSidebarRightGuideEntry[]
  }): () => void
}

interface CompatibleSlotRegistry {
  register(options: object, component: unknown): () => void
  inject(name: string, callback: () => (() => void) | Iterable<() => void>): () => void
}

export type BrowserClientContext = ClientContext & {
  connection: ConnectionHandle
  sidebarRight: CompatibleSidebarRight
  sidebarRightTabs: CompatibleSidebarRightTabs
  slots: CompatibleSlotRegistry
}

export interface BrowserTabParams {
  view?: BrowserPanelView
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'dsh-browser-workbench.browser': BrowserTabParams
  }
}

export const inject = [
  'slots',
  'connection',
  'sidebarRight',
  'sidebarRightTabs',
]

export function apply(ctx: BrowserClientContext): void {
  // BrowserWorkbench 的所有面板动作共用 Connection 已认证的精确 /api/browser-tools 路由。
  const port = createPort(ctx.connection)
  const controller = createPanelController(view => ctx.sidebarRight.openTab(BROWSER_TAB_KIND, { params: { view } }))

  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: BROWSER_TAB_ID,
        kind: BROWSER_TAB_KIND,
        priority: 'extension',
        title: () => 'BrowserWorkbench',
        // 输入框下方不再有入口，右侧栏「开始」页的这张卡是面板唯一的显式入口。
        guide: [
          {
            id: 'live',
            order: 20,
            title: () => '浏览器实况',
            description: () => '查看 Agent 正在操作的浏览器',
            icon: BrowserGlyph,
          },
        ],
      }),
    'browser scope tab type',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: BROWSER_TAB_ID,
            inject: () => ({ port, controller }),
          },
          BrowserPanel,
        ),
      ),
    'browser scope tab body',
  )

  // 绑定入口统一放在 DSH 设置页，输入框下方不再出现浏览器选择控件。
  // 注册模式通过宿主 configEditor 写回 Profile 补丁；服务缺失时该分区降级为只读说明。
  ctx.effect(
    () =>
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'browser',
            order: 60,
            label: () => BROWSER_SECTION_LABEL,
            inject: () => ({ port }),
          },
          BrowserSettingsSection,
        ),
      ),
    'browser scope settings section',
  )

  // 导航行图标由宿主按 section id 写死，这里认领自己那一行后替换成工作台图标。
  installSettingsNavIcon(ctx, () => BROWSER_SECTION_LABEL)

  ctx.effect(() => () => controller.close(), 'browser scope panel cleanup')
}
