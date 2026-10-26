import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeSnapshotFrames } from '../../src/client/utils/snapshot-merger.ts'

test('mergeSnapshotFrames retains previous frame when incremental snapshot has no frame', () => {
  const prevFrame = { mediaType: 'image/jpeg', data: 'abc', sequence: 10, streamGeneration: 1, viewportGeneration: 1, width: 800, height: 600 }
  const previous = {
    available: true,
    sessionId: 'session-1',
    tabs: [],
    console: [],
    network: [],
    frame: prevFrame,
  }

  const next = {
    available: true,
    sessionId: 'session-1',
    tabs: [],
    console: [],
    network: [],
  }

  const merged = mergeSnapshotFrames(previous, next, 'live', false, false, false)
  assert.equal(merged.frame, prevFrame)
})
