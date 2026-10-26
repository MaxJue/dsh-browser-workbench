import assert from 'node:assert/strict'
import test from 'node:test'
import { calculatePointProjection } from '../../src/client/utils/geometry.ts'
import { validateClipboardLimits } from '../../src/client/utils/clipboard.ts'
import { mergeSnapshotFrames } from '../../src/client/utils/snapshot-merger.ts'

test('calculatePointProjection scales point correctly with aspect ratio contain', () => {
  const rect = { left: 100, top: 50, width: 640, height: 360 }
  const frame = { width: 1280, height: 720 }

  // Exactly center
  const center = calculatePointProjection(rect, frame, 100 + 320, 50 + 180)
  assert.deepEqual(center, { x: 640, y: 360 })

  // Out of bounds without clamp returns undefined
  const outOfBounds = calculatePointProjection(rect, frame, 50, 50)
  assert.equal(outOfBounds, undefined)

  // Out of bounds with clamp clamps to bounds
  const clamped = calculatePointProjection(rect, frame, 50, 50, true)
  assert.deepEqual(clamped, { x: 0, y: 0 })
})

test('validateClipboardLimits enforces file count, single file size and total bytes', () => {
  const validFiles = [{ size: 1024 }]
  assert.deepEqual(validateClipboardLimits(validFiles, 100), { valid: true })

  // Exceeds max file count (8)
  const tooManyFiles = Array.from({ length: 9 }, () => ({ size: 10 }))
  const countError = validateClipboardLimits(tooManyFiles, 0)
  assert.equal(countError.valid, false)

  // Exceeds single file size (8MB)
  const singleTooLarge = [{ size: 8 * 1024 * 1024 + 1 }]
  const sizeError = validateClipboardLimits(singleTooLarge, 0)
  assert.equal(sizeError.valid, false)

  // Exceeds total size (16MB)
  const totalTooLarge = [{ size: 5 * 1024 * 1024 }, { size: 5 * 1024 * 1024 }]
  const totalError = validateClipboardLimits(totalTooLarge, 7 * 1024 * 1024)
  assert.equal(totalError.valid, false)
})

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
