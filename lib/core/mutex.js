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
    code = 'busy';
    constructor(message = 'another synchronization operation is already running') {
        super(message);
        this.name = 'BusyError';
    }
}
/** Serialized async task queue. */
export class Mutex {
    tail = Promise.resolve();
    running = false;
    waiting = 0;
    /** Whether a task currently holds the mutex. */
    isBusy() {
        return this.running;
    }
    /** Whether any task is running or queued. */
    isPending() {
        return this.running || this.waiting > 0;
    }
    /**
     * Run `task` after every earlier task settled.
     * @param task - work to run exclusively.
     * @param options.wait - when false, throw {@link BusyError} instead of queueing.
     */
    async runExclusive(task, options = {}) {
        if (options.wait === false && this.isPending())
            throw new BusyError();
        this.waiting += 1;
        const run = async () => {
            this.waiting -= 1;
            this.running = true;
            try {
                return await task();
            }
            finally {
                this.running = false;
            }
        };
        const next = this.tail.then(run, run);
        this.tail = next.catch(() => undefined);
        return next;
    }
}
