import css from '../../panel.module.css'

export interface ArbitratedToolsDialogProps {
  conflictingTools: readonly string[]
  onClose: () => void
}

export function ArbitratedToolsDialog({ conflictingTools, onClose }: ArbitratedToolsDialogProps) {
  if (conflictingTools.length === 0) return null

  return (
    <span className={css.controllerToolsMenu} role="dialog" aria-label="已仲裁工具列表">
      <span className={css.controllerToolsHeader}>
        <strong>已仲裁工具（{conflictingTools.length}）</strong>
        <button type="button" aria-label="关闭已仲裁工具列表" onClick={onClose}>
          ×
        </button>
      </span>
      <span className={css.controllerToolsList}>
        {conflictingTools.map(toolName => (
          <span key={toolName}>{toolName}</span>
        ))}
      </span>
    </span>
  )
}
