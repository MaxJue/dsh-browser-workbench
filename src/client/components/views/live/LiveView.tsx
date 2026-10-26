import css from '../../../panel.module.css'
import type { BrowserLiveViewMode, BrowserPanelSnapshot, BrowserSplitViewPane } from '../../../../domain/protocol.ts'
import { LivePane } from './LivePane.tsx'
import { LiveControls } from './LiveControls.tsx'
import { DiagnosticOverlay } from './DiagnosticOverlay.tsx'
import { SplitDivider } from '../../common/SplitDivider.tsx'

export interface LiveViewProps {
  snapshot: BrowserPanelSnapshot
  shareDragArmed: boolean
  splitRatio: number
  splitOrientation: 'top-bottom' | 'left-right'
  livePanelRef: React.RefObject<HTMLDivElement | null>
  liveCanvasRef: React.RefObject<HTMLDivElement | null>
  liveRef: React.RefObject<HTMLImageElement | null>
  topCanvasRef: React.RefObject<HTMLDivElement | null>
  bottomCanvasRef: React.RefObject<HTMLDivElement | null>
  topLiveRef: React.RefObject<HTMLImageElement | null>
  bottomLiveRef: React.RefObject<HTMLImageElement | null>
  splitContainerRef: React.RefObject<HTMLDivElement | null>
  dividerProps: {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  }
  onDragStart: (event: React.DragEvent<HTMLImageElement>) => void
  onDragEnd: () => void
  onFocusPane: (pane: BrowserSplitViewPane) => void
  onSwitchLiveView: (mode: BrowserLiveViewMode) => void
  onOpenSplitView: (orientation: 'top-bottom' | 'left-right') => void
  onCloseSplitView: () => void
  onToggleSplitOrientation: () => void
  onSwapSplitPanes: () => void
  onResetSplitRatio: () => void
  onToggleShareDrag: () => void
  onClosePanel: () => void
}

export function LiveView({
  snapshot,
  shareDragArmed,
  splitRatio,
  splitOrientation,
  livePanelRef,
  liveCanvasRef,
  liveRef,
  topCanvasRef,
  bottomCanvasRef,
  topLiveRef,
  bottomLiveRef,
  splitContainerRef,
  dividerProps,
  onDragStart,
  onDragEnd,
  onFocusPane,
  onSwitchLiveView,
  onOpenSplitView,
  onCloseSplitView,
  onToggleSplitOrientation,
  onSwapSplitPanes,
  onResetSplitRatio,
  onToggleShareDrag,
  onClosePanel,
}: LiveViewProps) {
  const paneSnapshot = (pane: BrowserSplitViewPane) =>
    snapshot.splitView?.panes?.find(item => item.pane === pane)

  return (
    <div ref={livePanelRef} className={css.livePanel}>
      <LiveControls
        snapshot={snapshot}
        splitOrientation={splitOrientation}
        shareDragArmed={shareDragArmed}
        onSwitchLiveView={onSwitchLiveView}
        onOpenSplitView={onOpenSplitView}
        onCloseSplitView={onCloseSplitView}
        onToggleSplitOrientation={onToggleSplitOrientation}
        onSwapSplitPanes={onSwapSplitPanes}
        onResetSplitRatio={onResetSplitRatio}
        onToggleShareDrag={onToggleShareDrag}
        onClosePanel={onClosePanel}
      />

      {snapshot.splitView?.enabled ? (
        <div
          ref={splitContainerRef}
          className={css.splitLive}
          data-orientation={splitOrientation}
          style={
            splitOrientation === 'left-right'
              ? { gridTemplateColumns: `minmax(0, ${splitRatio}fr) 8px minmax(0, ${1 - splitRatio}fr)` }
              : { gridTemplateRows: `minmax(0, ${splitRatio}fr) 8px minmax(0, ${1 - splitRatio}fr)` }
          }
        >
          <LivePane
            pane="top"
            paneState={paneSnapshot('top')}
            orientation={splitOrientation}
            imageRef={topLiveRef}
            canvasRef={topCanvasRef}
            shareDragArmed={shareDragArmed}
            inspect={snapshot.diagnostic?.latestInspect}
            onFocusPane={() => onFocusPane('top')}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
          <SplitDivider
            orientation={splitOrientation}
            splitRatio={splitRatio}
            onPointerDown={dividerProps.onPointerDown}
            onKeyDown={dividerProps.onKeyDown}
          />
          <LivePane
            pane="bottom"
            paneState={paneSnapshot('bottom')}
            orientation={splitOrientation}
            imageRef={bottomLiveRef}
            canvasRef={bottomCanvasRef}
            shareDragArmed={shareDragArmed}
            inspect={snapshot.diagnostic?.latestInspect}
            onFocusPane={() => onFocusPane('bottom')}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </div>
      ) : (
        <div ref={liveCanvasRef} className={css.liveCanvas}>
          {snapshot.frame === undefined ? (
            <div className={css.empty}>等待浏览器实况帧</div>
          ) : (
            <img
              ref={liveRef}
              className={css.live}
              src={`data:${snapshot.frame.mediaType};base64,${snapshot.frame.data}`}
              alt="浏览器实况"
              draggable={shareDragArmed}
              data-share-drag={shareDragArmed || undefined}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          )}
          {snapshot.frame === undefined || snapshot.activeViewId === undefined ? null : (
            <DiagnosticOverlay
              frame={snapshot.frame}
              viewId={snapshot.activeViewId}
              inspect={snapshot.diagnostic?.latestInspect}
            />
          )}
          {snapshot.diagnostic?.recorder.deepVisible && (
            <div className={css.deepRecordingBanner} role="status">
              当前记录中 · Deep Recording · 可在实况控制中暂停或停止
            </div>
          )}
        </div>
      )}
    </div>
  )
}
