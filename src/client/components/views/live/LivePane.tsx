import css from '../../../panel.module.css'
import type { BrowserDiagnosticPanelSnapshot, BrowserLivePaneSnapshot, BrowserSplitViewPane } from '../../../../domain/protocol.ts'
import { DiagnosticOverlay } from './DiagnosticOverlay.tsx'

export interface LivePaneProps {
  pane: BrowserSplitViewPane
  paneState?: BrowserLivePaneSnapshot
  orientation: 'top-bottom' | 'left-right'
  imageRef: React.RefObject<HTMLImageElement | null>
  canvasRef: React.RefObject<HTMLDivElement | null>
  shareDragArmed: boolean
  inspect?: BrowserDiagnosticPanelSnapshot['latestInspect']
  onFocusPane: () => void
  onDragStart: (event: React.DragEvent<HTMLImageElement>) => void
  onDragEnd: () => void
}

export function LivePane({
  pane,
  paneState,
  orientation,
  imageRef,
  canvasRef,
  shareDragArmed,
  inspect,
  onFocusPane,
  onDragStart,
  onDragEnd,
}: LivePaneProps) {
  const fullLabel =
    orientation === 'left-right'
      ? pane === 'top'
        ? '左侧网页'
        : '右侧网页'
      : pane === 'top'
        ? '上方网页'
        : '下方网页'

  return (
    <div
      className={css.livePane}
      data-focused={paneState?.focused || undefined}
      aria-label={`${fullLabel}${paneState?.focused ? '，当前焦点' : '，点击画面切换焦点'}`}
    >
      <div
        ref={canvasRef}
        className={css.liveCanvas}
        onPointerDown={() => {
          if (paneState?.focused !== true) onFocusPane()
        }}
      >
        {paneState?.frame === undefined ? (
          <div className={css.empty}>等待{fullLabel}实况帧</div>
        ) : (
          <img
            ref={imageRef}
            className={css.live}
            src={`data:${paneState.frame.mediaType};base64,${paneState.frame.data}`}
            alt={`${fullLabel}实况`}
            draggable={shareDragArmed}
            data-share-drag={shareDragArmed || undefined}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        )}
        {paneState?.frame === undefined || paneState.viewId === undefined ? null : (
          <DiagnosticOverlay frame={paneState.frame} viewId={paneState.viewId} inspect={inspect} />
        )}
      </div>
    </div>
  )
}
