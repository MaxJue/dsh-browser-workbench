import css from '../../../panel.module.css'
import type { BrowserPanelSnapshot, BrowserProfileInput } from '../../../../domain/protocol.ts'

export interface PerformanceViewProps {
  snapshot: BrowserPanelSnapshot
  runProfile: (input: BrowserProfileInput) => Promise<unknown>
}

export function PerformanceView({ snapshot, runProfile }: PerformanceViewProps) {
  return (
    <div className={css.domainPanel}>
      <div className={css.toolbar}>
        <button type="button" onClick={() => { void runProfile({ action: 'trace_start' }) }}>
          Trace 开始
        </button>
        <button type="button" onClick={() => { void runProfile({ action: 'trace_stop' }) }}>
          Trace 停止
        </button>
        <button type="button" onClick={() => { void runProfile({ action: 'playwright_trace_start' }) }}>
          Playwright Trace 开始
        </button>
        <button type="button" onClick={() => { void runProfile({ action: 'playwright_trace_stop' }) }}>
          Playwright Trace 停止
        </button>
        <button type="button" onClick={() => { void runProfile({ action: 'cpu_start' }) }}>
          CPU 开始
        </button>
        <button type="button" onClick={() => { void runProfile({ action: 'cpu_stop' }) }}>
          CPU 停止
        </button>
        <button type="button" onClick={() => { void runProfile({ action: 'coverage_start' }) }}>
          Coverage 开始
        </button>
        <button type="button" onClick={() => { void runProfile({ action: 'coverage_stop' }) }}>
          Coverage 停止
        </button>
        <button type="button" onClick={() => { void runProfile({ action: 'heap_snapshot' }) }}>
          Heap Snapshot
        </button>
        <button type="button" onClick={() => { void runProfile({ action: 'heap_sampling_start' }) }}>
          Heap Sampling 开始
        </button>
        <button type="button" onClick={() => { void runProfile({ action: 'heap_sampling_stop' }) }}>
          Heap Sampling 停止
        </button>
      </div>
      <section>
        <h3>制品</h3>
        {snapshot.artifacts?.length ? (
          snapshot.artifacts.map(item => (
            <div className={css.item} key={item.artifactId}>
              {item.kind} · {item.name} · {item.bytes} bytes · {item.artifactId}
            </div>
          ))
        ) : (
          <div className={css.empty}>暂无性能制品</div>
        )}
      </section>
    </div>
  )
}
