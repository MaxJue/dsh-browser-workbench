import type { ElementHandle } from 'playwright-core'
import type { ViewState } from '../domain/types.ts'

export async function releaseHandles(handles: Iterable<ElementHandle>): Promise<void> {
  const unique = new Set(handles)
  await Promise.allSettled([...unique].map(handle => handle.dispose()))
}

export async function releaseViewRefs(view: ViewState): Promise<void> {
  const handles = [...view.refs.values()].map(ref => ref.handle)
  view.refs.clear()
  await releaseHandles(handles)
}
