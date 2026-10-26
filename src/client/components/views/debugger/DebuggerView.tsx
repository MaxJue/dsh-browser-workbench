import { useState } from 'react'
import css from '../../../panel.module.css'
import type { BrowserDebuggerInput, BrowserPanelSnapshot } from '../../../../domain/protocol.ts'

const debuggerActions: Array<{ action: BrowserDebuggerInput['action']; label: string }> = [
  { action: 'attach', label: '连接' },
  { action: 'pause', label: '暂停' },
  { action: 'resume', label: '继续' },
  { action: 'step_over', label: '单步越过' },
  { action: 'step_into', label: '单步进入' },
  { action: 'step_out', label: '单步跳出' },
  { action: 'detach', label: '断开' },
]

export interface DebuggerViewProps {
  snapshot: BrowserPanelSnapshot
  runDebugger: (input: BrowserDebuggerInput) => Promise<unknown>
  setError: (error?: string) => void
}

export function DebuggerView({ snapshot, runDebugger, setError }: DebuggerViewProps) {
  const [breakpointUrl, setBreakpointUrl] = useState('')
  const [breakpointLine, setBreakpointLine] = useState('1')
  const [scope, setScope] = useState<unknown>()

  const debuggerStatus = snapshot.debugger?.paused
    ? `已暂停${snapshot.debugger.reason === undefined ? '' : `：${snapshot.debugger.reason}`}`
    : snapshot.debugger?.attached
      ? '已连接'
      : '未连接'

  const addBreakpoint = async () => {
    const line = Number(breakpointLine)
    if (breakpointUrl.trim() === '') {
      setError('请输入完整的脚本 URL。')
      return
    }
    if (!Number.isInteger(line) || line < 1) {
      setError('断点行号必须是大于或等于 1 的整数。')
      return
    }
    await runDebugger({ action: 'set_breakpoint', url: breakpointUrl.trim(), lineNumber: line - 1 })
  }

  return (
    <div className={css.debugger}>
      <div className={css.debuggerToolbar}>
        <span
          className={css.debuggerStatus}
          data-paused={snapshot.debugger?.paused || undefined}
          data-attached={snapshot.debugger?.attached || undefined}
        >
          {debuggerStatus}
        </span>
        <div className={css.actions}>
          {debuggerActions.map(item => (
            <button
              type="button"
              key={item.action}
              onClick={() => {
                void runDebugger({ action: item.action })
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className={css.breakpoint}>
        <input
          value={breakpointUrl}
          placeholder="脚本 URL"
          onChange={event => setBreakpointUrl(event.currentTarget.value)}
        />
        <input
          value={breakpointLine}
          inputMode="numeric"
          aria-label="断点行号（一基）"
          title="按编辑器显示的一基行号填写"
          onChange={event => setBreakpointLine(event.currentTarget.value)}
        />
        <button type="button" onClick={() => { void addBreakpoint() }}>
          添加断点
        </button>
      </div>

      <div className={css.debuggerBody}>
        <section>
          <h3>断点</h3>
          {snapshot.debugger?.breakpoints.length === 0 && <div className={css.empty}>暂无断点</div>}
          {snapshot.debugger?.breakpoints.map(item => (
            <button
              type="button"
              key={item.breakpointId}
              onClick={() => {
                void runDebugger({ action: 'remove_breakpoint', breakpointId: item.breakpointId })
              }}
            >
              {item.url}:{item.lineNumber + 1} ×
            </button>
          ))}
        </section>

        <section>
          <h3>调用栈</h3>
          {snapshot.debugger?.callFrames.length === 0 && <div className={css.empty}>页面未暂停</div>}
          {snapshot.debugger?.callFrames.map(frame => (
            <div key={frame.callFrameId}>
              <strong>{frame.functionName || '(anonymous)'}</strong> {frame.url}:{frame.lineNumber + 1}
              {frame.scopes.map((item, index) => (
                <button
                  type="button"
                  key={`${frame.callFrameId}-${index}`}
                  onClick={async () => {
                    const result = await runDebugger({
                      action: 'scope_variables',
                      callFrameId: frame.callFrameId,
                      scopeNumber: index,
                    })
                    const output = result as { data?: { properties?: unknown } } | undefined
                    setScope(output?.data?.properties ?? result)
                  }}
                >
                  {item.name ?? item.type}
                </button>
              ))}
            </div>
          ))}
        </section>

        <section>
          <h3>脚本</h3>
          {snapshot.debugger?.scripts.length === 0 ? (
            <div className={css.empty}>暂无脚本</div>
          ) : (
            snapshot.debugger?.scripts.map(item => (
              <div key={item.scriptId}>
                <span>{item.url}</span>
                <span>
                  <button
                    type="button"
                    onClick={async () => {
                      setScope(await runDebugger({ action: 'script_source', scriptId: item.scriptId }))
                    }}
                  >
                    源码
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setScope(await runDebugger({ action: 'source_map', scriptId: item.scriptId }))
                    }}
                  >
                    Map
                  </button>
                </span>
              </div>
            ))
          )}
        </section>

        <section>
          <h3>Scope</h3>
          {scope === undefined ? (
            <div className={css.empty}>暂停后选择 Scope 查看变量</div>
          ) : (
            <pre>{JSON.stringify(scope, null, 2)}</pre>
          )}
        </section>
      </div>
    </div>
  )
}
