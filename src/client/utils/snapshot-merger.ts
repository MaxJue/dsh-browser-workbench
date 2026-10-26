import type { BrowserPanelSnapshot, BrowserPanelView } from '../../domain/protocol.ts'

export function mergeSnapshotFrames(
  previous: BrowserPanelSnapshot,
  next: BrowserPanelSnapshot,
  view: BrowserPanelView,
  viewChanged: boolean,
  streamChanged: boolean,
  viewportChanged: boolean,
): BrowserPanelSnapshot {
  let mergedSnapshot = next

  if (view === 'live' && next.available && !viewChanged && !streamChanged && !viewportChanged && next.frame === undefined && previous.frame !== undefined) {
    mergedSnapshot = { ...mergedSnapshot, frame: previous.frame }
  } else if (view === 'live' && next.frame !== undefined && previous.frame !== undefined && !viewChanged && !streamChanged && !viewportChanged && next.frame.sequence < previous.frame.sequence) {
    mergedSnapshot = { ...mergedSnapshot, frame: previous.frame }
  }

  if (view === 'live' && next.splitView?.enabled) {
    const previousPanes = new Map((previous.splitView?.panes ?? []).map(item => [item.pane, item]))
    mergedSnapshot = {
      ...mergedSnapshot,
      splitView: {
        ...next.splitView,
        panes: (next.splitView.panes ?? []).map(item =>
          item.frame === undefined && previousPanes.get(item.pane)?.viewId === item.viewId
            ? { ...item, frame: previousPanes.get(item.pane)?.frame }
            : item,
        ),
      },
    }
  }

  return mergedSnapshot
}
