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
export declare class BusyError extends Error {
    readonly code = "busy";
    constructor(message?: string);
}
/** Serialized async task queue. */
export declare class Mutex {
    private tail;
    private running;
    private waiting;
    /** Whether a task currently holds the mutex. */
    isBusy(): boolean;
    /** Whether any task is running or queued. */
    isPending(): boolean;
    /**
     * Run `task` after every earlier task settled.
     * @param task - work to run exclusively.
     * @param options.wait - when false, throw {@link BusyError} instead of queueing.
     */
    runExclusive<T>(task: () => Promise<T>, options?: {
        wait?: boolean;
    }): Promise<T>;
}
