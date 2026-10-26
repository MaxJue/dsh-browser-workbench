import css from '../../panel.module.css'

export interface SplitDividerProps {
  orientation: 'top-bottom' | 'left-right'
  splitRatio: number
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
}

export function SplitDivider({ orientation, splitRatio, onPointerDown, onKeyDown }: SplitDividerProps) {
  return (
    <div
      className={css.splitDivider}
      data-orientation={orientation}
      role="separator"
      tabIndex={0}
      aria-label={orientation === 'left-right' ? '调整左右分屏比例' : '调整上下分屏比例'}
      aria-orientation={orientation === 'left-right' ? 'vertical' : 'horizontal'}
      aria-valuemin={40}
      aria-valuemax={60}
      aria-valuenow={Math.round(splitRatio * 100)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )
}
