import css from '../../panel.module.css'

export interface NavigationBarProps {
  activeViewId?: string
  address: string
  onAddressChange: (address: string) => void
  onNavigate: () => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
}

export function NavigationBar({
  activeViewId,
  address,
  onAddressChange,
  onNavigate,
  onBack,
  onForward,
  onReload,
}: NavigationBarProps) {
  const disabled = activeViewId === undefined

  return (
    <form
      className={css.navigationBar}
      onSubmit={event => {
        event.preventDefault()
        onNavigate()
      }}
    >
      <button type="button" aria-label="后退" disabled={disabled} onClick={onBack}>
        ←
      </button>
      <button type="button" aria-label="前进" disabled={disabled} onClick={onForward}>
        →
      </button>
      <button type="button" aria-label="刷新" disabled={disabled} onClick={onReload}>
        ↻
      </button>
      <input
        value={address}
        disabled={disabled}
        aria-label="浏览器地址"
        placeholder={disabled ? '请先新建标签' : '输入网址'}
        onChange={event => onAddressChange(event.currentTarget.value)}
      />
    </form>
  )
}
