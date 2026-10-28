/**
 * Mutual exclusion for operations that touch the same repository or state.
 *
 * DSH can call the plugin from the settings page, an agent tool, and a timer at
 * the same time; only one of them may run at once. A queue (not a lock) is used
 * so a legitimate second request waits instead of failing, with an explicit
 * "busy" report for callers that opt out of waiting.
 * @module core/mutex
 */

/** Error thrown by {@link Mutex.runExclusive} when it may not wait. */
export class BusyError extends Error {
  readonly code = 'busy'

  constructor(message = 'another synchronization operation is already running') {
    super(message)
    this.name = 'BusyError'
  }
}

/** Serialized async task queue. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve()
  private running = false
  private waiting = 0

  /** Whether a task currently holds the mutex. */
  isBusy(): boolean {
    return this.running
  }

  /** Whether any task is running or queued. */
  isPending(): boolean {
    return this.running || this.waiting > 0
  }

  /**
   * Run `task` after every earlier task settled.
   * @param task - work to run exclusively.
   * @param options.wait - when false, throw {@link BusyError} instead of queueing.
   */
  async runExclusive<T>(task: () => Promise<T>, options: { wait?: boolean } = {}): Promise<T> {
    if (options.wait === false && this.isPending()) throw new BusyError()
    this.waiting += 1
    const run = async (): Promise<T> => {
      this.waiting -= 1
      this.running = true
      try {
        return await task()
      } finally {
        this.running = false
      }
    }
    const next = this.tail.then(run, run)
    this.tail = next.catch(() => undefined)
    return next
  }
}
