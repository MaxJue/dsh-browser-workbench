import type { CDPSession } from 'playwright-core'

export interface RawCdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  on(event: string, listener: (payload: Record<string, unknown>) => void): RawCdpSession
  detach(): Promise<void>
}

export function rawCdp(session: CDPSession): RawCdpSession {
  return session as unknown as RawCdpSession
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

export function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
