import assert from 'node:assert/strict'
import test from 'node:test'
import { activitySignature, shouldAutoReveal } from '../../src/client/utils/auto-reveal.ts'

const activity = { available: true, tabCount: 1, activeViewId: 'view-a', activeUrl: 'https://example.com' }

test('activitySignature ignores probes without a page to show', () => {
  assert.equal(activitySignature(undefined), undefined)
  assert.equal(activitySignature({ available: false, tabCount: 0 }), undefined)
  assert.equal(activitySignature({ available: true, tabCount: 0, activeViewId: 'view-a' }), undefined)
  assert.equal(activitySignature(activity), '1|view-a|https://example.com|0.0')
})

test('activitySignature reports navigation, extra tabs and same-url work as new content', () => {
  const navigated = { ...activity, activeUrl: 'https://iana.org' }
  const extraTab = { ...activity, tabCount: 2, activeViewId: 'view-b' }
  const clicked = { ...activity, snapshotGeneration: 7 }
  assert.notEqual(activitySignature(activity), activitySignature(navigated))
  assert.notEqual(activitySignature(activity), activitySignature(extraTab))
  assert.notEqual(activitySignature(activity), activitySignature(clicked))
  assert.notEqual(
    activitySignature({ ...activity, navigationGeneration: 3 }),
    activitySignature({ ...activity, navigationGeneration: 4 }),
  )
})

test('shouldAutoReveal only fires for new content during a running turn', () => {
  const base = {
    activity,
    running: true,
    panelOpen: false,
    enabled: true,
    dismissed: false,
    revealedSignature: 'baseline',
  }
  assert.equal(shouldAutoReveal(base), true)
  assert.equal(shouldAutoReveal({ ...base, running: false }), false)
  assert.equal(shouldAutoReveal({ ...base, running: undefined }), false)
  assert.equal(shouldAutoReveal({ ...base, panelOpen: true }), false)
  assert.equal(shouldAutoReveal({ ...base, enabled: false }), false)
  assert.equal(shouldAutoReveal({ ...base, dismissed: true }), false)
  assert.equal(shouldAutoReveal({ ...base, activity: undefined }), false)
  assert.equal(shouldAutoReveal({ ...base, activity: { available: true, tabCount: 0 } }), false)
})

test('shouldAutoReveal stays quiet for content it already revealed and wakes up on the next change', () => {
  const base = {
    activity,
    running: true,
    panelOpen: false,
    enabled: true,
    dismissed: false,
    revealedSignature: activitySignature(activity),
  }
  assert.equal(shouldAutoReveal(base), false)
  assert.equal(shouldAutoReveal({ ...base, activity: { ...activity, activeUrl: 'https://iana.org' } }), true)
})
