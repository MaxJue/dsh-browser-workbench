import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateClosureHealth } from '../../src/diagnostics/l3-closure.ts'

test('qualifies a clean run with comparable non-regressed evidence', () => {
  assert.deepEqual(evaluateClosureHealth({
    runtimeErrorCount: 0,
    failedRequestCount: 0,
    comparison: { comparable: true, overallVerdict: 'unchanged', newRegressionCount: 0 },
  }), {
    closureSchemaVersion: 1,
    runtimeCleanQualified: true,
    compareQualified: true,
    failedRequestReviewRequired: false,
    productClosureQualified: true,
    blockers: [],
  })
})

test('keeps runtime, comparison and failed-request blockers distinct', () => {
  const result = evaluateClosureHealth({
    runtimeErrorCount: 1,
    failedRequestCount: 2,
    comparison: { comparable: true, overallVerdict: 'regressed', newRegressionCount: 1 },
  })
  assert.equal(result.productClosureQualified, false)
  assert.deepEqual(result.blockers, [
    'runtime-errors-remain',
    'compare-regressed',
    'new-regressions-remain',
    'failed-request-visible-outcome-unverified',
  ])
})

test('missing and incomparable comparisons do not qualify', () => {
  assert.deepEqual(evaluateClosureHealth({ runtimeErrorCount: 0, failedRequestCount: 0 }).blockers, ['compare-missing'])
  assert.deepEqual(evaluateClosureHealth({
    runtimeErrorCount: 0,
    failedRequestCount: 0,
    comparison: { comparable: false },
  }).blockers, ['compare-incomparable'])
})
