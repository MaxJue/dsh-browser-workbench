import type { CdpState } from './cdp-state.ts'
import { string, type RawCdpSession } from './cdp-raw.ts'

export function bindCdpProfileEvents(client: RawCdpSession, state: CdpState, maxArtifactBytes: number): void {
  client.on('Tracing.tracingComplete', payload => {
    state.profile.resolveTrace?.(payload)
    state.profile.resolveTrace = undefined
  })
  client.on('HeapProfiler.addHeapSnapshotChunk', payload => {
    const chunk = string(payload.chunk)
    if (state.profile.heapSnapshotChunks === undefined || state.profile.heapSnapshotOverflow === true) return
    state.profile.heapSnapshotBytes = (state.profile.heapSnapshotBytes ?? 0) + Buffer.byteLength(chunk)
    if (state.profile.heapSnapshotBytes > maxArtifactBytes) {
      state.profile.heapSnapshotOverflow = true
      state.profile.heapSnapshotChunks.length = 0
      return
    }
    state.profile.heapSnapshotChunks.push(chunk)
  })
}
