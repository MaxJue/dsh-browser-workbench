import type { BrowserPanelActivity, BrowserPanelView } from '../domain/protocol.ts'
import type { PanelController } from './panel-controller.ts'
import { activitySignature, shouldAutoReveal } from './utils/auto-reveal.ts'

/** 宿主明确说明 `panel_activity` 是按秒可轮询的只读探测，这里沿用一秒一次的节奏。 */
const DEFAULT_INTERVAL_MS = 1000

/** 主视图 Session 的身份与运行状态；两者都来自 `ctx.uiSession` 的根观察源。 */
export interface AutoRevealSessionSource {
  /** 面板所属的主视图 Session；没有选中 Session 时为 undefined。 */
  current(): string | undefined
  /** 主视图切换或任一 Session 的运行状态变化时通知。 */
  subscribe(listener: () => void): () => void
  /** 该 Session 最近一次已知的运行状态；尚未建立基线时为 undefined。 */
  running(sessionId: string): boolean | undefined
}

/** 定时器注入点，测试用它把轮询改成手动触发。 */
export interface AutoRevealTimer {
  repeat(task: () => void, intervalMs: number): () => void
}

export interface AutoRevealOptions {
  sessions: AutoRevealSessionSource
  controller: PanelController
  /** 关闭状态下的只读活动探测；探测失败按「没有内容」处理。 */
  probe(sessionId: string): Promise<BrowserPanelActivity | undefined>
  /** 自动展开时面板要停在哪一页，当前只服务实况。 */
  view: BrowserPanelView
  intervalMs?: number
  timer?: AutoRevealTimer
}

const defaultTimer: AutoRevealTimer = {
  repeat(task, intervalMs) {
    const handle = globalThis.setInterval(task, intervalMs)
    return () => { globalThis.clearInterval(handle) }
  },
}

/**
 * 让 agent 一用浏览器就展开右侧面板，同时不和用户抢视线。
 *
 * 只在「本轮回答进行中 + 面板关闭 + 出现还没展开过的新内容」时打开；打开前用
 * `panel_activity` 做只读探测，绝不为此创建会话或启动 screencast。用户在我们自动展开后
 * 亲手关掉面板，就在本轮回答余下时间里保持安静；轮次结束（running 转 false）后重置，
 * 下一轮重新获得一次机会。
 */
export function installAutoReveal(options: AutoRevealOptions): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const timer = options.timer ?? defaultTimer
  /** 每个 Session 最后一次自动展开时的活动指纹，同一内容不再重复打开。 */
  const revealed = new Map<string, string>()
  /** 已被用户亲手关掉的 Session：本轮回答内不再自动展开。 */
  const dismissed = new Set<string>()
  /** 本轮回答里我们真的展开过面板的 Session；只有它们才把「关闭」算作用户拒绝。 */
  const autoRevealed = new Set<string>()
  const running = new Map<string, boolean>()
  let stopTimer: (() => void) | undefined
  let stopPanel: (() => void) | undefined
  let watched: string | undefined
  let panelOpen = false
  let probing = false
  let disposed = false

  const stopPolling = (): void => {
    if (stopTimer === undefined) return
    stopTimer()
    stopTimer = undefined
  }

  const tick = async (): Promise<void> => {
    if (probing) return
    const sessionId = options.sessions.current()
    if (sessionId === undefined || options.controller.getSnapshot(sessionId).open) return
    probing = true
    try {
      const activity = await options.probe(sessionId)
      // 探测期间可能已经切换 Session 或卸载；过期结果一律丢弃。
      if (disposed || options.sessions.current() !== sessionId) return
      const signature = activitySignature(activity)
      if (signature === undefined) return
      const reveal = shouldAutoReveal({
        activity,
        running: options.sessions.running(sessionId),
        panelOpen: options.controller.getSnapshot(sessionId).open,
        enabled: true,
        dismissed: dismissed.has(sessionId),
        revealedSignature: revealed.get(sessionId),
      })
      if (!reveal) return
      if (!options.controller.open(sessionId, options.view).ok) return
      revealed.set(sessionId, signature)
      autoRevealed.add(sessionId)
      // 面板挂载会通过 subscribe 再触发一次 sync；先停表，避免同一轮重复探测。
      stopPolling()
    } catch {
      // 探测失败不是用户可见错误，下一轮再试。
    } finally {
      probing = false
    }
  }

  const watchPanel = (sessionId: string | undefined): void => {
    stopPanel?.()
    stopPanel = undefined
    watched = sessionId
    panelOpen = sessionId !== undefined && options.controller.getSnapshot(sessionId).open
    if (sessionId === undefined) return
    const target = sessionId
    stopPanel = options.controller.subscribe(target, state => {
      // 只有我们替用户展开过、随后又由用户关掉，才算用户拒绝本轮自动展开。
      if (panelOpen && !state.open && autoRevealed.has(target)) dismissed.add(target)
      panelOpen = state.open
      sync()
    })
  }

  const sync = (): void => {
    if (disposed) return
    const sessionId = options.sessions.current()
    const currentRunning = sessionId === undefined ? undefined : options.sessions.running(sessionId)
    if (sessionId !== undefined) {
      const previous = running.get(sessionId)
      if (previous === true && currentRunning !== true) {
        // 一轮回答结束：下一轮重新获得一次自动展开的机会。
        dismissed.delete(sessionId)
        autoRevealed.delete(sessionId)
      }
      if (currentRunning === undefined) running.delete(sessionId)
      else running.set(sessionId, currentRunning)
    }
    if (sessionId !== watched) watchPanel(sessionId)
    const active = sessionId !== undefined
      && currentRunning === true
      && !panelOpen
      && !dismissed.has(sessionId)
    if (active && stopTimer === undefined) {
      stopTimer = timer.repeat(() => { void tick() }, intervalMs)
    } else if (!active) {
      stopPolling()
    }
  }

  const unsubscribe = options.sessions.subscribe(sync)
  sync()

  return () => {
    disposed = true
    unsubscribe()
    stopPolling()
    stopPanel?.()
    stopPanel = undefined
  }
}
