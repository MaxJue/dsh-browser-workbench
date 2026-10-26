import assert from 'node:assert/strict'
import test from 'node:test'
import { releaseReceiptText, releaseReceiptTime } from '../../src/client/utils/controller-receipt.ts'

test('releaseReceiptTime formats local time as HH:MM:SS', () => {
  const stamp = new Date(2026, 9, 26, 14, 9, 41).getTime()
  assert.equal(releaseReceiptTime(stamp), '14:09:41')
  assert.equal(releaseReceiptText(stamp), '已释放 · 14:09:41')
})

test('releaseReceiptTime rejects missing or invalid timestamps', () => {
  assert.equal(releaseReceiptTime(undefined), undefined)
  assert.equal(releaseReceiptText(undefined), undefined)
  assert.equal(releaseReceiptTime(Number.NaN), undefined)
  assert.equal(releaseReceiptTime(Number.POSITIVE_INFINITY), undefined)
  assert.equal(releaseReceiptTime(0), undefined)
  assert.equal(releaseReceiptTime(-1), undefined)
})
