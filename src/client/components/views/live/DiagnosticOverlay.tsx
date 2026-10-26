import css from '../../../panel.module.css'
import type { BrowserDiagnosticPanelSnapshot, BrowserPanelSnapshot } from '../../../../domain/protocol.ts'

export interface DiagnosticOverlayProps {
  frame: NonNullable<BrowserPanelSnapshot['frame']>
  viewId: string
  inspect?: BrowserDiagnosticPanelSnapshot['latestInspect']
}

export function DiagnosticOverlay({ frame, viewId, inspect }: DiagnosticOverlayProps) {
  if (inspect === undefined || inspect.viewId !== viewId) return null

  return (
    <svg
      className={css.diagnosticOverlay}
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {inspect.target.box !== undefined && (
        <rect
          className={css.diagnosticTarget}
          x={inspect.target.box.x}
          y={inspect.target.box.y}
          width={inspect.target.box.width}
          height={inspect.target.box.height}
        />
      )}
      {inspect.occluder !== undefined && (
        <rect
          className={css.diagnosticOccluder}
          x={inspect.occluder.box.x}
          y={inspect.occluder.box.y}
          width={inspect.occluder.box.width}
          height={inspect.occluder.box.height}
        />
      )}
    </svg>
  )
}
