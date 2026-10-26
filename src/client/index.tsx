import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { BrowserPanelView } from '../domain/protocol.ts'
import { createPanelController } from './panel-controller.ts'
import { createPort } from './port.ts'
import { BrowserControl } from './components/control/BrowserControl.tsx'
import { BrowserPanel } from './components/panel/BrowserPanel.tsx'

const BROWSER_TAB_ID = 'dsh-browser-workbench/browser'
const BROWSER_TAB_KIND = 'dsh-browser-workbench.browser'

interface CompatibleSidebarRightTab {
  id: string
  kind: string
}

interface CompatibleSidebarRight {
  openTab(kind: string, options?: { params?: BrowserTabParams }): void
  close(tabId: string): void
  active(): CompatibleSidebarRightTab | undefined
}

interface CompatibleSidebarRightTabs {
  register(definition: {
    id: string
    kind: string
    priority?: 'extension' | 'builtin' | 'fallback'
    title(address: string): string
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

  ctx.effect(
    () =>
      ctx.slots.inject('conversation.input.right', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.right',
            id: 'browser-panel',
            order: 50,
            inject: () => ({ controller, port }),
          },
          BrowserControl,
        ),
      ),
    'browser scope conversation control',
  )

  ctx.effect(() => () => controller.close(), 'browser scope panel cleanup')
}
