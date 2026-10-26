import css from '../../panel.module.css'
import type { PanelController } from '../../panel-controller.ts'
import type { Port } from '../../port.ts'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { usePanelSync } from '../../hooks/usePanelSync.ts'
import { useControllerBinding } from '../../hooks/useControllerBinding.ts'
import { ControllerMenu } from './ControllerMenu.tsx'
import { ArbitratedToolsDialog } from './ArbitratedToolsDialog.tsx'

type SessionSlotProps<K extends 'conversation.input.right' | 'sidebar.right.pane.tab'> = PropsRuntime<K> & {
  sessionId: string
}

export function BrowserControl({
  sessionId,
  controller,
  port,
  useSession,
}: SessionSlotProps<'conversation.input.right'> & { controller: PanelController; port: Port }) {
  const panelState = usePanelSync(controller, sessionId)
  const currentSessionBlank = useSession((state: { readonly blank: boolean }) => state.blank)
  const panelAvailable = currentSessionBlank === false

  const {
    modalState,
    dispatch,
    message,
    controllerState,
    loadingController,
    switching,
    active,
    BrowserWorkbenchUnavailable,
    unselected,
    selectedOther,
    otherBrowserToolsAvailable,
    controllerLabel,
    refreshController,
    activate,
    selectOther,
    release,
    toggle,
    selectView,
  } = useControllerBinding(sessionId, controller, port, panelAvailable, panelState.open, panelState.view ?? 'live')

  return (
    <span className={css.control}>
      <button
        type="button"
        className={css.controlButton}
        aria-expanded={modalState.menuOpen}
        onClick={() => dispatch({ type: 'TOGGLE_MENU' })}
      >
        浏览器
      </button>
      <span className={css.controllerBadge} data-active={(!loadingController && active) || undefined}>
        {controllerLabel}
      </span>

      {modalState.menuOpen && (
        <ControllerMenu
          controllerState={controllerState}
          controllerLabel={controllerLabel}
          loadingController={loadingController}
          active={active}
          switching={switching}
          panelAvailable={panelAvailable}
          unselected={unselected}
          selectedOther={selectedOther}
          BrowserWorkbenchUnavailable={BrowserWorkbenchUnavailable}
          otherBrowserToolsAvailable={otherBrowserToolsAvailable}
          confirmType={modalState.confirmType}
          panelOpen={panelState.open}
          currentView={panelState.view ?? 'live'}
          arbitratedToolsOpen={modalState.arbitratedToolsOpen}
          onRefresh={() => { void refreshController() }}
          onSetConfirm={confirmType => dispatch({ type: 'SET_CONFIRM', confirmType })}
          onToggleTools={() => dispatch({ type: 'TOGGLE_TOOLS' })}
          onActivate={() => { void activate() }}
          onSelectOther={() => { void selectOther() }}
          onRelease={() => { void release() }}
          onTogglePanel={toggle}
          onSelectView={selectView}
        />
      )}

      {modalState.menuOpen && modalState.arbitratedToolsOpen && controllerState?.conflictingTools.length ? (
        <ArbitratedToolsDialog
          conflictingTools={controllerState.conflictingTools}
          onClose={() => dispatch({ type: 'CLOSE_TOOLS' })}
        />
      ) : null}

      {message !== undefined && <span className={css.controlMessage}>{message}</span>}
    </span>
  )
}
