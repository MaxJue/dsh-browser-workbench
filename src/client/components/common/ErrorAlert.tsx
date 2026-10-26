import css from '../../panel.module.css'

export interface ErrorAlertProps {
  error?: string
  onClose: () => void
}

export function ErrorAlert({ error, onClose }: ErrorAlertProps) {
  if (error === undefined) return null

  return (
    <div className={css.errorMessage} role="alert">
      <span>{error}</span>
      <button type="button" aria-label="关闭浏览器错误提示" onClick={onClose}>
        ×
      </button>
    </div>
  )
}
