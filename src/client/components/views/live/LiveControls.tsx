import css from '../../../panel.module.css'
import type { BrowserLiveViewMode, BrowserPanelSnapshot } from '../../../../domain/protocol.ts'

export interface LiveControlsProps {
  snapshot: BrowserPanelSnapshot
  splitOrientation: 'top-bottom' | 'left-right'
  shareDragArmed: boolean
  onSwitchLiveView: (mode: BrowserLiveViewMode) => void
  onOpenSplitView: (orientation: 'top-bottom' | 'left-right') => void
  onCloseSplitView: () => void
  onToggleSplitOrientation: () => void
  onSwapSplitPanes: () => void
  onResetSplitRatio: () => void
  onToggleShareDrag: () => void
  onClosePanel: () => void
}

// 实况控制只服务人：看画面、切显示、双页比对、拖拽分享。agent 向的诊断与
// 录制操作属于工具能力，不在这里重复。
export function LiveControls({
  snapshot,
  splitOrientation,
  shareDragArmed,
  onSwitchLiveView,
  onOpenSplitView,
  onCloseSplitView,
  onToggleSplitOrientation,
  onSwapSplitPanes,
  onResetSplitRatio,
  onToggleShareDrag,
  onClosePanel,
}: LiveControlsProps) {
  return (
    <details className={css.liveControls}>
      <summary>实况控制</summary>
      <div className={css.liveControlPanel}>
        <div className={css.liveControlStatus}>
          <span>
            {snapshot.liveView === undefined
              ? '等待画面尺寸'
              : `当前画面 ${snapshot.liveView.width}×${snapshot.liveView.height}${snapshot.liveView.reflowed ? `，重排 ${snapshot.liveView.reflowedElements}` : ''}`}
          </span>
        </div>
        <div className={css.liveControlActions}>
          <button
            type="button"
            aria-label="切换为标准显示"
            title="标准显示：固定1280×720，完整显示桌面布局"
            data-selected={snapshot.liveView?.mode === 'standard' || undefined}
            onClick={() => onSwitchLiveView('standard')}
          >
            标准显示
          </button>
          <button
            type="button"
            aria-label="切换为自适应显示"
            title="自适应显示：真实Viewport跟随可用区域"
            data-selected={snapshot.liveView?.mode === 'adaptive' || undefined}
            onClick={() => onSwitchLiveView('adaptive')}
          >
            自适应显示
          </button>
          {!snapshot.splitView?.enabled ? (
            <>
              <button
                type="button"
                aria-label="开启上下双页显示"
                title="将两个网页按上下排列"
                onClick={() => onOpenSplitView('top-bottom')}
              >
                上下双页
              </button>
              <button
                type="button"
                aria-label="开启左右双页显示"
                title="将两个网页按左右排列"
                onClick={() => onOpenSplitView('left-right')}
              >
                左右双页
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                aria-label="返回单页显示"
                title="关闭双页并保留焦点标签"
                onClick={onCloseSplitView}
              >
                返回单页
              </button>
              <button
                type="button"
                aria-label={splitOrientation === 'left-right' ? '切换为上下双页' : '切换为左右双页'}
                onClick={onToggleSplitOrientation}
              >
                {splitOrientation === 'left-right' ? '切换上下' : '切换左右'}
              </button>
              <button
                type="button"
                aria-label={splitOrientation === 'left-right' ? '交换左右网页' : '交换上下网页'}
                onClick={onSwapSplitPanes}
              >
                {splitOrientation === 'left-right' ? '交换左右' : '交换上下'}
              </button>
              <button
                type="button"
                aria-label="恢复双页均分"
                title="恢复50/50均分"
                onClick={onResetSplitRatio}
              >
                恢复均分
              </button>
            </>
          )}
          <button
            type="button"
            aria-pressed={shareDragArmed}
            aria-label={shareDragArmed ? '取消拖拽分享画面' : '武装下一次拖拽分享画面'}
            title={
              shareDragArmed
                ? '下一次从实况画面拖动会生成对话图片附件；拖拽结束后自动关闭'
                : '仅武装下一次画面拖拽，普通拖动不会生成附件'
            }
            data-selected={shareDragArmed || undefined}
            onClick={onToggleShareDrag}
          >
            {shareDragArmed ? '等待拖拽画面' : '拖拽分享画面'}
          </button>
          <button type="button" aria-label="关闭右侧浏览器" title="关闭右侧浏览器" onClick={onClosePanel}>
            关闭右侧浏览器
          </button>
        </div>
      </div>
    </details>
  )
}
