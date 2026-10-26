import { existsSync } from 'node:fs'
import type { ResolvedConfig, SessionState } from '../domain/types.ts'

const WINDOWS_BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

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

export function executablePath(config: ResolvedConfig): string | undefined {
  if (config.executablePath !== undefined) return config.executablePath
  return WINDOWS_BROWSERS.find(existsSync)
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
