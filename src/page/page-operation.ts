import { abortReason } from '../domain/errors.ts'
import type { Page } from 'playwright-core'
import { isNavigationTimeoutError } from './navigation-state.ts'

export async function stopOnAbort<T>(page: Page, signal: AbortSignal, operation: Promise<T>): Promise<T> {
  if (signal.aborted) throw abortReason(signal)
  let remove = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    const onAbort = () => {
      reject(abortReason(signal))
      void page.close({ runBeforeUnload: false }).catch(() => {})
    }
    signal.addEventListener('abort', onAbort, { once: true })
    remove = () => signal.removeEventListener('abort', onAbort)
  })
  try {
    return await Promise.race([operation, cancelled])
  } finally {
    remove()
    if (signal.aborted) await Promise.allSettled([operation])
  }
}

/**
 * Waits for a history traversal started by `page.goBack()`. A bfcache restore
 * completes without firing `domcontentloaded`, so the navigation promise only
 * settles after its full timeout; the URL changes long before that, and callers
 * should proceed as soon as it does. Only a timeout is tolerated once the URL
 * moved — every other failure is still raised.
 */
export async function awaitBackNavigation(
  page: Pick<Page, 'url'>,
  before: string,
  navigation: Promise<unknown>,
  pollMs = 100,
): Promise<void> {
  let poll: ReturnType<typeof setInterval> | undefined
  let failure: { error: unknown } | undefined
  const watched = navigation.then(() => {}, error => { failure = { error } })
  const restored = new Promise<void>(resolve => {
    poll = setInterval(() => {
      if (page.url() !== before) resolve()
    }, pollMs)
  })
  try {
    await Promise.race([watched, restored])
  } finally {
    if (poll !== undefined) clearInterval(poll)
  }
  if (failure === undefined) return
  if (!isNavigationTimeoutError(failure.error) || page.url() === before) throw failure.error
}
