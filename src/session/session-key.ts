import type { Identity } from '../domain/types.ts'

export function sessionKey(identity: Pick<Identity, 'sessionId' | 'sessionCreatedAt'>): string {
  return `${identity.sessionId}@${identity.sessionCreatedAt}`
}

export function pendingSessionKey(sessionId: string): string {
  return `${sessionId}@pending`
}
