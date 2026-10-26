import css from '../../../panel.module.css'

export function ExtensionsView() {
  return (
    <div className={css.domainPanel}>
      <div className={css.status}>
        外部 CDP 模式只连接现有浏览器页面。扩展由 Chrome 或 Edge 自己管理，DSH 不下载、安装、启用、禁用或卸载扩展。
      </div>
    </div>
  )
}
