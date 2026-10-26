import type { SessionState, ViewState } from '../domain/types.ts'

export interface ScreencastSyncDependencies {
  visibleViewIds: (session: SessionState) => Set<string>
  recorderStatus: (session: SessionState) => { mode: string; status: string }
  ensureScreencast: (session: SessionState, view: ViewState, consumer: 'live-view' | 'recorder') => Promise<void>
  releaseScreencast: (view: ViewState, consumer: 'live-view' | 'recorder') => Promise<void>
}

export async function syncScreencasts(session: SessionState, views: Iterable<ViewState>, dependencies: ScreencastSyncDependencies): Promise<void> {
  const visible = dependencies.visibleViewIds(session)
  const recorder = dependencies.recorderStatus(session)
  const recorderVisible = recorder.mode === 'deep' && recorder.status === 'recording'
  await Promise.all([...views].map(async view => {
    const isVisible = visible.has(view.viewId)
    if (session.liveView.open && isVisible) await dependencies.ensureScreencast(session, view, 'live-view')
    else await dependencies.releaseScreencast(view, 'live-view')
    if (recorderVisible && isVisible) await dependencies.ensureScreencast(session, view, 'recorder')
    else await dependencies.releaseScreencast(view, 'recorder')
  }))
}
