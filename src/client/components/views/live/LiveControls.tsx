import css from '../../../panel.module.css'
import type { BrowserLiveViewMode, BrowserPanelSnapshot, BrowserPanelView } from '../../../../domain/protocol.ts'

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
  onToggleTakeover: () => void
  onToggleShareDrag: () => void
  onOpenDiagnostic: (view: BrowserPanelView) => void
  onRecorderAction: (action: 'start' | 'pause' | 'resume' | 'mark' | 'clear' | 'stop', mode?: 'rolling' | 'deep') => void
  onClosePanel: () => void
}

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
  onToggleTakeover,
  onToggleShareDrag,
  onOpenDiagnostic,
  onRecorderAction,
  onClosePanel,
}: LiveControlsProps) {
  const userTakeover = snapshot.control?.owner === 'user'

  return (
    <details className={css.liveControls}>
      <summary>实况控制</summary>
      <div className={css.liveControlPanel}>
        <div className={css.liveControlStatus}>
          <span>{userTakeover ? '人工控制中' : '模型控制中'}</span>
          <span>
            {snapshot.liveView === undefined
              ? '等待画面尺寸'
              : `当前画面 ${snapshot.liveView.width}×${snapshot.liveView.height}${snapshot.liveView.reflowed ? `，重排 ${snapshot.liveView.reflowedElements}` : ''}`}
          </span>
          <span>
            {snapshot.diagnostic?.active
              ? `${snapshot.diagnostic.debugSession?.debugSessionId ?? 'Debug Session'} · ${snapshot.diagnostic.recording ? 'Recording' : 'Stopped'}`
              : '未启动 Debug Session'}
          </span>
          <span>
            {snapshot.diagnostic === undefined
              ? '等待诊断状态'
              : `${snapshot.diagnostic.currentIdentity.viewId} · D${snapshot.diagnostic.currentIdentity.documentGeneration} · ${snapshot.diagnostic.currentIdentity.navigationId}`}
          </span>
          <span>
            {snapshot.diagnostic === undefined
              ? '等待 Viewport'
              : `Viewport ${snapshot.diagnostic.currentIdentity.viewport.width}×${snapshot.diagnostic.currentIdentity.viewport.height} · DPR ${snapshot.diagnostic.currentIdentity.viewport.deviceScaleFactor}${snapshot.diagnostic.currentIdentity.viewport.mobile ? ' · Mobile' : ''}`}
          </span>
          <span>
            {snapshot.diagnostic?.synchronization.status === 'same-view'
              ? '页面与证据同 View'
              : snapshot.diagnostic?.synchronization.status === 'mismatch'
                ? '页面与证据身份不一致'
                : '暂无调试会话绑定'}
          </span>
          <span>
            {snapshot.diagnostic?.debugSession?.currentCheckpoint === undefined
              ? '暂无 Checkpoint'
              : `当前 ${snapshot.diagnostic.debugSession.currentCheckpoint.checkpointId} · ${snapshot.diagnostic.debugSession.currentCheckpoint.label}`}
          </span>
          <span>
            {snapshot.diagnostic?.unread.total === 0
              ? '无未读异常'
              : `未读异常 ${snapshot.diagnostic?.unread.total ?? 0} · Console ${snapshot.diagnostic?.unread.consoleErrors ?? 0} · Network ${snapshot.diagnostic?.unread.failedRequests ?? 0}`}
          </span>
          <span>
            {snapshot.diagnostic === undefined
              ? '等待 Recorder 状态'
              : `Recorder ${snapshot.diagnostic.recorder.mode} · ${snapshot.diagnostic.recorder.status} · ${snapshot.diagnostic.recorder.eventCount} events · ${snapshot.diagnostic.recorder.byteSize} bytes`}
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
            aria-label={userTakeover ? '归还浏览器控制权给模型' : '人工接管浏览器'}
            title={userTakeover ? '归还浏览器控制权给模型' : '人工接管；接管后点击网页并直接使用键盘'}
            onClick={onToggleTakeover}
          >
            {userTakeover ? '归还模型' : '人工接管'}
          </button>
          <button
            type="button"
            disabled={!userTakeover}
            aria-pressed={shareDragArmed}
            aria-label={shareDragArmed ? '取消拖拽分享画面' : '武装下一次拖拽分享画面'}
            title={
              !userTakeover
                ? '请先人工接管浏览器'
                : shareDragArmed
                  ? '下一次从实况画面拖动会生成对话图片附件；拖拽结束后自动关闭'
                  : '仅武装下一次画面拖拽，普通拖动不会生成附件'
            }
            data-selected={shareDragArmed || undefined}
            onClick={onToggleShareDrag}
          >
            {shareDragArmed ? '等待拖拽画面' : '拖拽分享画面'}
          </button>
          <button
            type="button"
            aria-label="打开诊断工作台"
            title="查看当前 Debug Session、Action、Checkpoint 和 Incident"
            onClick={() => onOpenDiagnostic('diagnostic')}
          >
            打开诊断
          </button>
          {snapshot.diagnostic?.recorder.mode === 'off' && (
            <button type="button" onClick={() => onRecorderAction('start', 'rolling')}>
              开启 Rolling
            </button>
          )}
          {snapshot.diagnostic?.recorder.mode !== 'deep' && (
            <button type="button" onClick={() => onRecorderAction('start', 'deep')}>
              开启 Deep
            </button>
          )}
          {snapshot.diagnostic?.recorder.status === 'recording' && (
            <button type="button" onClick={() => onRecorderAction('pause')}>
              暂停 Recorder
            </button>
          )}
          {snapshot.diagnostic?.recorder.status === 'paused' && (
            <button type="button" onClick={() => onRecorderAction('resume')}>
              继续 Recorder
            </button>
          )}
          {snapshot.diagnostic?.recorder.mode !== 'off' && (
            <button type="button" onClick={() => onRecorderAction('mark')}>
              刚才出问题了
            </button>
          )}
          {snapshot.diagnostic?.recorder.mode !== 'off' && (
            <button type="button" onClick={() => onRecorderAction('clear')}>
              清空未冻结记录
            </button>
          )}
          {snapshot.diagnostic?.recorder.mode !== 'off' && (
            <button type="button" onClick={() => onRecorderAction('stop')}>
              关闭 Recorder
            </button>
          )}
          <button type="button" aria-label="关闭右侧浏览器" title="关闭右侧浏览器" onClick={onClosePanel}>
            关闭右侧浏览器
          </button>
        </div>
      </div>
    </details>
  )
}
