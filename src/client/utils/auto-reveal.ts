import type { BrowserPanelActivity } from '../../domain/protocol.ts'

/**
 * 一次活动探测的稳定指纹。
 *
 * 只有「出现了页面」或「页面状态变了」才算新内容；没有页面或浏览器不可用时返回
 * `undefined`，调用方据此根本不该展开面板。把 tabCount 也放进指纹，是为了让
 * 「同一个页面被关掉又开回来」这类变化仍然算作新内容；把 snapshot/navigation 代次也
 * 放进去，是为了让 agent 在同一个地址上点击、滚动、读快照时同样能被发现。
 */
export function activitySignature(activity: BrowserPanelActivity | undefined): string | undefined {
  if (activity === undefined || activity.available !== true || activity.tabCount <= 0) return undefined
  const generations = `${activity.navigationGeneration ?? 0}.${activity.snapshotGeneration ?? 0}`
  return `${activity.tabCount}|${activity.activeViewId ?? ''}|${activity.activeUrl ?? ''}|${generations}`
}

export interface AutoRevealDecision {
  activity: BrowserPanelActivity | undefined
  running: boolean | undefined
  panelOpen: boolean
  enabled: boolean
  dismissed: boolean
  revealedSignature: string | undefined
}

/**
 * 是否应该因为 agent 正在使用浏览器而自动展开右侧面板。
 *
 * 只在回答进行中、面板处于关闭、且出现了「还没展开过的新内容」时成立；
 * 用户手动关掉面板后由 dismissed 拦住，避免面板和用户抢视线。
 */
export function shouldAutoReveal(input: AutoRevealDecision): boolean {
  if (input.enabled !== true || input.panelOpen || input.running !== true || input.dismissed) return false
  const signature = activitySignature(input.activity)
  if (signature === undefined) return false
  return signature !== input.revealedSignature
}
