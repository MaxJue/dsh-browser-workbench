import css from '../../panel.module.css'
import type { BrowserControllerSnapshot, BrowserPanelView } from '../../../domain/protocol.ts'
import { panelViews as views } from '../../panel-model.ts'
import type { ConfirmDialogType } from '../../hooks/useControllerBinding.ts'

const viewLabels: Record<BrowserPanelView, string> = {
  live: '实况',
  diagnostic: '诊断',
  console: 'Console',
  network: 'Network',
  debugger: 'Debugger',
  performance: 'Performance',
  provider: 'Provider',
  extensions: '扩展管理',
  emulation: 'Emulation',
}

export interface ControllerMenuProps {
  controllerState?: BrowserControllerSnapshot
  controllerLabel: string
  loadingController: boolean
  active: boolean
  switching: boolean
  panelAvailable: boolean
  unselected: boolean
  selectedOther: boolean
  BrowserWorkbenchUnavailable: boolean
  otherBrowserToolsAvailable: boolean
  confirmType: ConfirmDialogType
  panelOpen: boolean
  currentView: BrowserPanelView
  arbitratedToolsOpen: boolean
  onRefresh: () => void
  onSetConfirm: (confirmType: ConfirmDialogType) => void
  onToggleTools: () => void
  onActivate: () => void
  onSelectOther: () => void
  onRelease: () => void
  onTogglePanel: () => void
  onSelectView: (view: BrowserPanelView) => void
}

export function ControllerMenu({
  controllerState,
  controllerLabel,
  loadingController,
  active,
  switching,
  panelAvailable,
  unselected,
  selectedOther,
  BrowserWorkbenchUnavailable,
  otherBrowserToolsAvailable,
  confirmType,
  panelOpen,
  currentView,
  arbitratedToolsOpen,
  onRefresh,
  onSetConfirm,
  onToggleTools,
  onActivate,
  onSelectOther,
  onRelease,
  onTogglePanel,
  onSelectView,
}: ControllerMenuProps) {
  return (
    <span className={css.menu}>
      <span className={css.controllerStatus}>当前 Session：{controllerLabel}</span>
      {loadingController && (
        <span className={css.controllerConfirm}>
          <span>尚未确认当前 Session 的浏览器控制器，完整浏览器面板不会在此期间启动。</span>
          <button type="button" onClick={onRefresh}>
            重新读取控制器状态
          </button>
        </span>
      )}

      {unselected && confirmType === 'none' && (
        <>
          {!panelAvailable && (
            <span className={css.controllerStatus}>
              当前会话使用临时空白 Session；发送首条消息形成正式 Session 后，才可选择浏览器工具。
            </span>
          )}
          <span className={css.controllerStatus}>
            每个 Session 只能选择一套浏览器工具。选定后不能在本 Session 中更换，因为不同插件的页面、标签、元素引用和登录状态不能安全混用。
          </span>
          {!otherBrowserToolsAvailable && (
            <span className={css.controllerStatus}>
              当前 Profile 没有检测到其他浏览器工具，只能选择 DSH BrowserWorkbench。
            </span>
          )}
          <button
            type="button"
            disabled={switching || !panelAvailable || !otherBrowserToolsAvailable}
            onClick={() => onSetConfirm('other')}
          >
            使用其他浏览器工具
          </button>
          <button
            type="button"
            disabled={switching || !panelAvailable}
            onClick={() => onSetConfirm('activate')}
          >
            使用 DSH BrowserWorkbench
          </button>
        </>
      )}

      {selectedOther && (
        <span className={css.controllerConfirm}>
          <strong>当前 Session 已锁定其他浏览器工具</strong>
          <span>BrowserWorkbench 不会在本 Session 注册工具或创建浏览器资源。需要使用 BrowserWorkbench 时，请新建 Session。</span>
        </span>
      )}

      {BrowserWorkbenchUnavailable && (
        <span className={css.controllerConfirm}>
          <strong>当前 Session 已锁定 BrowserWorkbench，但本次恢复失败</strong>
          <span>{controllerState?.error ?? 'BrowserWorkbench 当前暂不可用。'}</span>
          <span>为避免混用浏览器状态，本 Session 不会改为其他浏览器插件。请修复环境或重新加载 BrowserWorkbench 后再试；需要使用其他插件时，请新建 Session。</span>
          <button type="button" onClick={onRefresh}>
            重新读取状态
          </button>
        </span>
      )}

      {unselected && confirmType === 'other' && (
        <span className={css.controllerConfirm}>
          <strong>确认使用其他浏览器工具</strong>
          <span>确认后，当前 Session 将永久使用现有的其他浏览器工具，不能再启用 BrowserWorkbench。</span>
          <span>这样可以避免不同插件的页面、标签、元素引用和登录状态在同一个 Session 中混用。</span>
          <span className={css.controllerActions}>
            <button type="button" disabled={switching} onClick={onSelectOther}>
              确认选择
            </button>
            <button type="button" disabled={switching} onClick={() => onSetConfirm('none')}>
              取消
            </button>
          </span>
        </span>
      )}

      {unselected && confirmType === 'activate' && (
        <span className={css.controllerConfirm}>
          <strong>确认使用 DSH BrowserWorkbench</strong>
          <span>确认后，当前 Session 将永久使用 BrowserWorkbench 的 30 个工具，其他浏览器工具会在本 Session 中隐藏。</span>
          <span>需要使用其他浏览器插件时，请新建 Session。第三方插件本身及其他 Session 不受影响。</span>
          <span className={css.controllerActions}>
            <button type="button" disabled={switching} onClick={onActivate}>
              确认选择
            </button>
            <button type="button" disabled={switching} onClick={() => onSetConfirm('none')}>
              取消
            </button>
          </span>
        </span>
      )}

      {active && confirmType !== 'release' && (
        <>
          {!panelAvailable && (
            <span className={css.controllerStatus}>
              当前会话尚未形成正式 Agent Session；发送首条消息后可打开完整面板。
            </span>
          )}
          <span className={css.controllerStatus}>
            当前 Session 已锁定 BrowserWorkbench。关闭标签或释放资源不会改变选择。
          </span>
          <button type="button" disabled={!panelAvailable} onClick={onTogglePanel}>
            {panelOpen ? '关闭 BrowserWorkbench 标签' : '打开 BrowserWorkbench 标签'}
          </button>
          {views.map(item => (
            <button
              type="button"
              key={item}
              disabled={!panelAvailable}
              data-selected={currentView === item || undefined}
              onClick={() => onSelectView(item)}
            >
              {viewLabels[item]}
            </button>
          ))}
          {controllerState?.registrationMode === 'session-select' && (
            <button type="button" disabled={switching} onClick={() => onSetConfirm('release')}>
              释放 BrowserWorkbench 资源
            </button>
          )}
        </>
      )}

      {active && confirmType === 'release' && (
        <span className={css.controllerConfirm}>
          <strong>确认释放 BrowserWorkbench 资源</strong>
          <span>页面、调试状态和当前 Session 的 BrowserWorkbench 浏览器资源会被关闭。工具选择仍保持 BrowserWorkbench，不能改用其他浏览器插件。</span>
          <span>后续再次调用 BrowserWorkbench 工具时会创建新的 BrowserWorkbench 页面。</span>
          <span className={css.controllerActions}>
            <button type="button" disabled={switching} onClick={onRelease}>
              确认释放
            </button>
            <button type="button" disabled={switching} onClick={() => onSetConfirm('none')}>
              取消
            </button>
          </span>
        </span>
      )}

      {controllerState?.conflictingTools.length ? (
        <button type="button" aria-expanded={arbitratedToolsOpen} onClick={onToggleTools}>
          已仲裁工具（{controllerState.conflictingTools.length}）
        </button>
      ) : null}
    </span>
  )
}
