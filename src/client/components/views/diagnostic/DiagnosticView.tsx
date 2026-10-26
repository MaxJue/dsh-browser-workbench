import css from '../../../panel.module.css'
import type { BrowserPanelSnapshot, BrowserRecorderInput } from '../../../../domain/protocol.ts'

export interface DiagnosticViewProps {
  snapshot: BrowserPanelSnapshot
  runRecorder: (input: BrowserRecorderInput) => Promise<unknown>
}

export function DiagnosticView({ snapshot, runRecorder }: DiagnosticViewProps) {
  const diag = snapshot.diagnostic

  return (
    <div className={css.diagnosticPanel}>
      <section className={css.diagnosticSummary}>
        <div>
          <strong>Debug Session</strong>
          <span>{diag?.debugSession?.debugSessionId ?? '未启动'}</span>
        </div>
        <div>
          <strong>Recording</strong>
          <span>{diag?.recording ? '进行中' : '未进行'}</span>
        </div>
        <div>
          <strong>身份</strong>
          <span>
            {diag === undefined
              ? '不可用'
              : `${diag.currentIdentity.viewId} / D${diag.currentIdentity.documentGeneration} / ${diag.currentIdentity.navigationId}`}
          </span>
        </div>
        <div>
          <strong>Viewport</strong>
          <span>
            {diag === undefined
              ? '不可用'
              : `${diag.currentIdentity.viewport.width}×${diag.currentIdentity.viewport.height} / DPR ${diag.currentIdentity.viewport.deviceScaleFactor}${diag.currentIdentity.viewport.mobile ? ' / Mobile' : ''}`}
          </span>
        </div>
        <div>
          <strong>控制权</strong>
          <span>{snapshot.control?.owner === 'user' ? '人工' : '模型'}</span>
        </div>
        <div>
          <strong>同 View</strong>
          <span>{diag?.synchronization.status ?? '不可用'}</span>
        </div>
        <div>
          <strong>未读异常</strong>
          <span>{diag?.unread.total ?? 0}</span>
        </div>
        <div>
          <strong>Context Topology</strong>
          <span>
            {diag?.contextTopology === undefined
              ? '未启用'
              : `T${diag.contextTopology.targetCount} / F${diag.contextTopology.frameCount} / E${diag.contextTopology.executionContextCount}${diag.contextTopology.truncated ? ' / 已截断' : ''}`}
          </span>
        </div>
        <div>
          <strong>主 Frame</strong>
          <span>{diag?.contextTopology?.mainFrameId ?? '不可用'}</span>
        </div>
        <div>
          <strong>能力降级</strong>
          <span>{diag?.contextTopology?.degradationCount ?? 0}</span>
        </div>
        <div>
          <strong>Flight Recorder</strong>
          <span>{diag === undefined ? '不可用' : `${diag.recorder.mode} / ${diag.recorder.status}`}</span>
        </div>
        <div>
          <strong>Recorder Window</strong>
          <span>
            {diag === undefined
              ? '不可用'
              : `${diag.recorder.retentionMs / 1000}s / ${diag.recorder.eventCount} events / ${diag.recorder.chunkCount} chunks`}
          </span>
        </div>
        <div>
          <strong>Recorder 配额</strong>
          <span>{diag === undefined ? '不可用' : `${diag.recorder.byteSize} bytes / ${diag.recorder.overload}`}</span>
        </div>
        <div>
          <strong>冻结 Incident</strong>
          <span>{diag?.recorder.frozenIncidentIds.length ?? 0}</span>
        </div>
        <div>
          <strong>Build Topology</strong>
          <span>
            {diag === undefined
              ? '不可用'
              : `${diag.buildTopology.activeBuildCount}/${diag.buildTopology.buildCount} active · ${diag.buildTopology.scriptCount} scripts${diag.buildTopology.truncated ? ' · 已截断' : ''}`}
          </span>
        </div>
        <div>
          <strong>Application Topology</strong>
          <span>
            {diag === undefined
              ? '不可用'
              : `${diag.applicationTopology.confirmedApplicationCount}/${diag.applicationTopology.activeApplicationCount} confirmed · ${diag.applicationTopology.applicationCount} total${diag.applicationTopology.truncated ? ' · 已截断' : ''}`}
          </span>
        </div>
      </section>

      <section>
        <h3>Flight Recorder</h3>
        <div className={css.toolbar}>
          <button
            type="button"
            disabled={diag?.recorder.mode !== 'off'}
            onClick={() => { void runRecorder({ action: 'start', mode: 'rolling' }) }}
          >
            开启 Rolling
          </button>
          <button
            type="button"
            onClick={() => { void runRecorder({ action: 'start', mode: 'deep' }) }}
          >
            开启 Deep
          </button>
          <button
            type="button"
            disabled={diag?.recorder.status !== 'recording'}
            onClick={() => { void runRecorder({ action: 'pause' }) }}
          >
            暂停
          </button>
          <button
            type="button"
            disabled={diag?.recorder.status !== 'paused'}
            onClick={() => { void runRecorder({ action: 'resume' }) }}
          >
            继续
          </button>
          <button
            type="button"
            disabled={diag?.recorder.mode === 'off'}
            onClick={() => { void runRecorder({ action: 'mark' }) }}
          >
            刚才出问题了
          </button>
          <button
            type="button"
            disabled={diag?.recorder.mode === 'off'}
            onClick={() => { void runRecorder({ action: 'clear' }) }}
          >
            清空未冻结记录
          </button>
          <button
            type="button"
            disabled={diag?.recorder.mode === 'off'}
            onClick={() => { void runRecorder({ action: 'stop' }) }}
          >
            关闭
          </button>
        </div>
      </section>

      <section>
        <h3>Action Timeline</h3>
        {diag?.timeline.length ? (
          diag.timeline.map(item => (
            <div className={css.diagnosticItem} key={item.actionId}>
              <span>
                <strong>{item.actionId}</strong> · {item.humanInitiated ? '人工' : '模型'} · {item.outcome}
              </span>
              <span>{item.toolName}</span>
              <small>
                D{item.documentGeneration} · {item.navigationId} · 关联证据 {item.relatedEvidenceCount}
              </small>
            </div>
          ))
        ) : (
          <div className={css.empty}>暂无 Action</div>
        )}
      </section>

      <section>
        <h3>Checkpoint</h3>
        {diag?.debugSession?.checkpoints.length ? (
          diag.debugSession.checkpoints.map(item => (
            <div className={css.diagnosticItem} key={item.checkpointId}>
              <span>
                <strong>{item.checkpointId}</strong> · {item.label}
              </span>
              <small>
                {item.viewId} · D{item.documentGeneration} · {item.navigationId}
              </small>
            </div>
          ))
        ) : (
          <div className={css.empty}>暂无 Checkpoint</div>
        )}
      </section>

      <section>
        <h3>Compare</h3>
        {diag?.latestComparison === undefined ? (
          <div className={css.empty}>暂无 Compare 摘要</div>
        ) : (
          <div className={css.diagnosticItem}>
            <span>
              <strong>{diag.latestComparison.overallVerdict}</strong> · {diag.latestComparison.beforeCheckpointId} →{' '}
              {diag.latestComparison.afterCheckpointId}
            </span>
            <small>
              {diag.latestComparison.comparable ? '环境可比' : '环境不可比'} · 新回归{' '}
              {diag.latestComparison.newRegressionCount}
            </small>
            {diag.latestComparison.l3Verdict !== undefined && (
              <small>
                L3 {diag.latestComparison.l3Verdict} ·{' '}
                {diag.latestComparison.l3Comparable ? '上下文可比' : '上下文不可比'}
              </small>
            )}
          </div>
        )}
      </section>

      <section>
        <h3>Incident</h3>
        {diag?.latestIncident === undefined ? (
          <div className={css.empty}>暂无 Incident 摘要</div>
        ) : (
          <div className={css.diagnosticItem}>
            <span>
              <strong>{diag.latestIncident.incidentId}</strong> · {diag.latestIncident.verificationStatus}
            </span>
            <small>
              Facts {diag.latestIncident.factCount} · Candidates {diag.latestIncident.causalCandidateCount} ·{' '}
              {diag.latestIncident.reportBytes} bytes
            </small>
            {diag.latestIncident.crossContextLinkCount !== undefined && (
              <small>
                Cross Context Links {diag.latestIncident.crossContextLinkCount}
                {diag.latestIncident.l3Verdict === undefined ? '' : ` · L3 ${diag.latestIncident.l3Verdict}`}
              </small>
            )}
          </div>
        )}
      </section>

      <section>
        <h3>Inspect</h3>
        {diag?.latestInspect === undefined ? (
          <div className={css.empty}>当前页面没有可显示的 Inspect 摘要</div>
        ) : (
          <div className={css.diagnosticItem}>
            <span>
              <strong>{diag.latestInspect.ref}</strong> · {diag.latestInspect.target.tag}
              {diag.latestInspect.target.accessibleName === undefined
                ? ''
                : ` · ${diag.latestInspect.target.accessibleName}`}
            </span>
            <small>
              {diag.latestInspect.occluder === undefined
                ? '目标未被顶层元素遮挡'
                : `Occluder：${diag.latestInspect.occluder.tag}${diag.latestInspect.occluder.id === undefined ? '' : `#${diag.latestInspect.occluder.id}`}`}
            </small>
          </div>
        )}
      </section>

      <section>
        <h3>Takeover</h3>
        {diag?.takeover?.latestSummary === undefined ? (
          <div className={css.empty}>{diag?.takeover?.active ? '人工接管进行中' : '暂无人工介入摘要'}</div>
        ) : (
          <div className={css.diagnosticItem}>
            <span>
              <strong>人工动作 {diag.takeover.latestSummary.actionCount}</strong> ·{' '}
              {diag.takeover.active ? '接管中' : '已交还'}
            </span>
            <small>
              文档变化 {String(diag.takeover.latestSummary.documentChanged)} · 导航变化{' '}
              {String(diag.takeover.latestSummary.navigationChanged)} · Console{' '}
              {diag.takeover.latestSummary.newConsoleErrors} · Network{' '}
              {diag.takeover.latestSummary.newFailedRequests}
            </small>
          </div>
        )}
      </section>
    </div>
  )
}
