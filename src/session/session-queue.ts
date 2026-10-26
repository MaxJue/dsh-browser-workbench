export interface QueueState {
  queue: Promise<void>
}

export async function queueExclusive<T>(state: QueueState, operation: () => Promise<T>): Promise<T> {
  const previous = state.queue
  let release!: () => void
  state.queue = new Promise<void>(resolve => { release = resolve })
  try {
    try {
      await previous
    } catch {}
    return await operation()
  } finally {
    release()
  }
}

export async function queueExclusiveMany<T>(states: readonly QueueState[], key: (state: QueueState) => string, operation: () => Promise<T>): Promise<T> {
  const sorted = [...states].sort((left, right) => key(left).localeCompare(key(right)))
  const releases: Array<() => void> = []
  try {
    for (const state of sorted) {
      const previous = state.queue
      let release!: () => void
      state.queue = new Promise<void>(resolve => { release = resolve })
      releases.push(release)
      try {
        await previous
      } catch {}
    }
    return await operation()
  } finally {
    for (const release of releases.reverse()) {
      try { release() } catch {}
    }
  }
}
