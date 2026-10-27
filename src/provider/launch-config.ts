import { existsSync } from 'node:fs'
import type { ResolvedConfig, SessionState } from '../domain/types.ts'

const WINDOWS_BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

const MACOS_BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
]

const LINUX_BROWSERS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
]

export function defaultCandidateBrowsers(platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'darwin') {
    const home = env.HOME
    return [
      ...MACOS_BROWSERS,
      ...(home !== undefined && home !== '' ? [
        `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
        `${home}/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`,
        `${home}/Applications/Chromium.app/Contents/MacOS/Chromium`,
        `${home}/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`,
      ] : []),
    ]
  }
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA
    return [
      ...WINDOWS_BROWSERS,
      ...(localAppData !== undefined && localAppData !== '' ? [
        `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
        `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ] : []),
    ]
  }
  return LINUX_BROWSERS
}

export function browserLaunchNetwork(config: ResolvedConfig): {
  args: string[]
  proxy?: { server: string; bypass?: string; username?: string; password?: string }
} {
  if (config.proxy.mode === 'direct') return { args: ['--no-proxy-server'] }
  if (config.proxy.mode === 'custom') {
    return {
      args: [],
      proxy: {
        server: config.proxy.server as string,
        ...(config.proxy.bypass === undefined ? {} : { bypass: config.proxy.bypass }),
        ...(config.proxy.username === undefined ? {} : { username: config.proxy.username }),
        ...(config.proxy.password === undefined ? {} : { password: config.proxy.password }),
      },
    }
  }
  return { args: [] }
}

export function executablePath(config: ResolvedConfig, platform = process.platform, env = process.env): string | undefined {
  if (config.executablePath !== undefined) return config.executablePath
  return defaultCandidateBrowsers(platform, env).find(existsSync)
}

export function splitViewState(preference: { ratio: number; orientation: 'top-bottom' | 'left-right' } = { ratio: 0.5, orientation: 'top-bottom' }): SessionState['splitView'] {
  return {
    enabled: false,
    focusedPane: 'top',
    orientation: preference.orientation,
    ratio: preference.ratio,
    changedAt: Date.now(),
    panes: { top: {}, bottom: {} },
  }
}
