export const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222'

export function normalizeCdpEndpoint(value: string): string {
  const input = value.trim()
  if (input === '') return DEFAULT_CDP_ENDPOINT
  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `http://${input}`
  const url = new URL(withProtocol)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('CDP 地址必须使用 http 或 https')
  url.pathname = url.pathname.replace(/\/$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function connectionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/ECONNREFUSED|timed out|timeout|connect/i.test(message)) {
    return '连接失败：请确认 Chrome 正在运行，并使用远程调试端口 9222 启动。'
  }
  return message || '连接失败，请检查远程调试地址。'
}
