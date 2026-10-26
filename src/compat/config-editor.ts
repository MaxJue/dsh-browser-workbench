import type { Context } from '@deepseek-ai/cordis'

/** 本插件在 Profile 补丁里的 loader 条目 id（`cordis.patch.yml` 的 `- id: browser-tools`）。 */
export const BROWSER_ENTRY_ID = 'browser-tools'
/** 补丁条目未写 id 时按包名兜底匹配。 */
export const BROWSER_ENTRY_NAME = 'dsh-browser-workbench'

/** 设置页里的一张卡片：用哪套浏览器工具。 */
export type BrowserToolChoice = 'workbench' | 'existing' | 'off'

/** `configEditor` 服务里本插件需要的最小结构：按条目解析、按条目写回并热重载。 */
interface ConfigEditorEntryLike {
  options: { id: string; name?: string }
}

interface ConfigEditorLike {
  entries(): ConfigEditorEntryLike[]
  edit(
    entry: ConfigEditorEntryLike,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<unknown>
}

export interface BrowserSettingsWriteResult {
  /** 是否找到可写的配置条目。 */
  wrote: boolean
  /** 未写入时的原因，供设置页直接展示。 */
  message?: string
}

export interface BrowserSettingsWriteState {
  /** 设置页是否可以真正写回配置。 */
  configurable: boolean
  /** 不可写时的原因。 */
  message?: string
}

/** 卡片到补丁字段的映射：workbench 自动启动浏览器，existing 不自动启动、由 Agent 连接现有 Chrome/Edge。 */
export function browserChoicePatch(choice: BrowserToolChoice, endpoint?: string): Record<string, unknown> {
  switch (choice) {
    case 'workbench': return { toolRegistrationMode: 'global', providerMode: 'auto' }
    case 'existing': return {
      toolRegistrationMode: 'global',
      providerMode: 'external',
      ...(endpoint === undefined ? {} : { externalCdpEndpoint: endpoint }),
    }
    case 'off': return { toolRegistrationMode: 'disabled' }
  }
}

/** 从当前配置反推卡片选中态。 */
export function browserChoiceOf(registrationMode: string, providerMode: string): BrowserToolChoice {
  if (registrationMode === 'disabled') return 'off'
  return providerMode === 'external' ? 'existing' : 'workbench'
}

/** 只读地判断配置能否写回，供设置页在渲染前决定是否禁用卡片。 */
export function browserSettingsWriteState(ctx: Context): BrowserSettingsWriteState {
  const editor = readConfigEditor(ctx)
  if (editor === undefined) {
    return { configurable: false, message: '当前 DSH 未提供配置编辑服务，浏览器绑定只能手改 Profile 补丁。' }
  }
  if (findBrowserEntry(editor) === undefined) {
    return { configurable: false, message: `Profile 补丁里没有 id 为 ${BROWSER_ENTRY_ID} 的配置条目，绑定无法写回。` }
  }
  return { configurable: true }
}

function findBrowserEntry(editor: ConfigEditorLike): ConfigEditorEntryLike | undefined {
  const entries = editor.entries()
  return entries.find(candidate => candidate.options.id === BROWSER_ENTRY_ID)
    ?? entries.find(candidate => candidate.options.name === BROWSER_ENTRY_NAME)
}

function readConfigEditor(ctx: Context): ConfigEditorLike | undefined {
  const service = (ctx as unknown as { get(name: string): unknown }).get('configEditor')
  if (typeof service !== 'object' || service === null) return undefined
  const candidate = service as Partial<ConfigEditorLike>
  if (typeof candidate.entries !== 'function' || typeof candidate.edit !== 'function') return undefined
  return candidate as ConfigEditorLike
}

/**
 * 把浏览器绑定写回 Profile 补丁并让 Loader 热重载。
 * 宿主没有配置编辑器（只读部署、精简发行版）时返回可读原因，由设置页降级为说明。
 */
export async function writeBrowserChoice(ctx: Context, choice: BrowserToolChoice, endpoint?: string): Promise<BrowserSettingsWriteResult> {
  const editor = readConfigEditor(ctx)
  if (editor === undefined) {
    return { wrote: false, message: '当前 DSH 未提供配置编辑服务，浏览器绑定只能手改 Profile 补丁。' }
  }
  const entry = findBrowserEntry(editor)
  if (entry === undefined) {
    return { wrote: false, message: `Profile 补丁里没有 id 为 ${BROWSER_ENTRY_ID} 的配置条目，绑定无法写回。` }
  }
  const patch = browserChoicePatch(choice, endpoint)
  await editor.edit(entry, current => ({ ...current, ...patch }))
  return { wrote: true }
}
