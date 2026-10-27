import assert from 'node:assert/strict'
import test from 'node:test'
import { browserLaunchNetwork, defaultCandidateBrowsers, executablePath, splitViewState } from '../../src/provider/launch-config.ts'

const config = proxy => ({ executablePath: 'custom-browser', proxy })

test('launch config projects direct and custom proxy modes', () => {
  assert.deepEqual(browserLaunchNetwork(config({ mode: 'direct' })), { args: ['--no-proxy-server'] })
  assert.deepEqual(browserLaunchNetwork(config({ mode: 'custom', server: 'http://proxy.test', bypass: 'localhost' })), { args: [], proxy: { server: 'http://proxy.test', bypass: 'localhost' } })
  assert.equal(executablePath(config({ mode: 'system' })), 'custom-browser')
})

test('defaultCandidateBrowsers returns platform-specific browser paths', () => {
  const mac = defaultCandidateBrowsers('darwin', { HOME: '/Users/tester' })
  assert.ok(mac.includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))
  assert.ok(mac.includes('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'))
  assert.ok(mac.includes('/Users/tester/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))

  const win = defaultCandidateBrowsers('win32', { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' })
  assert.ok(win.includes('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'))
  assert.ok(win.includes('C:\\Users\\tester\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'))

  const linux = defaultCandidateBrowsers('linux', {})
  assert.ok(linux.includes('/usr/bin/google-chrome'))
  assert.ok(linux.includes('/usr/bin/chromium'))
})

test('splitViewState creates a default pane state and accepts restored preferences', () => {
  const initial = splitViewState()
  assert.equal(initial.enabled, false)
  assert.equal(initial.focusedPane, 'top')
  assert.equal(initial.orientation, 'top-bottom')
  assert.equal(initial.ratio, 0.5)
  assert.equal(typeof initial.changedAt, 'number')
  assert.deepEqual(initial.panes, { top: {}, bottom: {} })
  const restored = splitViewState({ ratio: 0.6, orientation: 'left-right' })
  assert.equal(restored.ratio, 0.6)
  assert.equal(restored.orientation, 'left-right')
})

