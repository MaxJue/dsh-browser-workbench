import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultAttempts } from '../../src/provider/chromium-manager.ts'

const descriptor = {
  revision: '1248',
  browserVersion: '156.0.8078.4',
  platform: 'win64',
  archiveName: 'chrome-win64.zip',
  executableRelativePath: 'chrome-win64\\chrome.exe',
  directoryName: 'chromium-1248',
  archiveBytes: 1,
  archiveMd5: '0'.repeat(32),
}

test('npmmirror is the only attempt for the mirror source', () => {
  assert.deepEqual(defaultAttempts('npmmirror', descriptor), [{
    source: 'npmmirror',
    url: 'https://cdn.npmmirror.com/binaries/chrome-for-testing/156.0.8078.4/win64/chrome-win64.zip',
    allowedHosts: ['cdn.npmmirror.com'],
  }])
})

test('official keeps both playwright hosts allowed', () => {
  assert.deepEqual(defaultAttempts('official', descriptor), [{
    source: 'official',
    url: 'https://cdn.playwright.dev/builds/cft/156.0.8078.4/win64/chrome-win64.zip',
    allowedHosts: ['cdn.playwright.dev', 'storage.googleapis.com'],
  }])
})

test('auto tries the mirror before the official build', () => {
  const attempts = defaultAttempts('auto', descriptor)
  assert.deepEqual(attempts.map(attempt => attempt.source), ['npmmirror', 'official'])
  for (const attempt of attempts) {
    assert.match(attempt.url, /^https:\/\//)
    assert.ok(attempt.allowedHosts.includes(new URL(attempt.url).hostname))
  }
  assert.equal(new Set(attempts.map(attempt => attempt.source)).size, attempts.length)
})
