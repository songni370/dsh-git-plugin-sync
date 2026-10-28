/**
 * Path validation and safe joining.
 *
 * Backup contents are untrusted input (another device, or a repository the
 * user cloned from anywhere), so every manifest-derived relative path is
 * validated before it touches the filesystem or a Git work tree: absolute
 * paths, drive-letter paths, URL schemes, parent traversal, NUL bytes and
 * symlinked escape routes are all refused.
 * @module core/paths
 */
/** Expand `~`, `~/` and `~\` against the OS home. */
export declare function expandHomePath(input: string): string;
/** Whether a string can be a legal relative backup path (POSIX/JGit form). */
export declare function isSafeRelativePath(input: string): boolean;
/**
 * Join a validated relative path onto a trusted root.
 * @throws when the relative path is unsafe or escapes the root.
 */
export declare function safeJoin(root: string, relative: string): string;
/**
 * Normalize a configured backup directory into a safe repository-relative form.
 * Accepts `''`, `'.'`, `'backup'`, `'backup/'`, `'a/b'` and `'./a/b'`.
 * @throws when the value is absolute, traversing, or otherwise unsafe.
 */
export declare function normalizeBackupDir(input: string): string;
/** Join repository-relative segments, tolerating an empty base. */
export declare function repoPath(...segments: string[]): string;
/** A filesystem-safe file name derived from a plugin id. */
export declare function safeFileName(id: string, maxLength?: number): string;
/** Default data directory for a DSH home. */
export declare function dataDirFor(dshHome: string): string;
/** OS temp root used by tests and snapshot staging. */
export declare function tempRoot(): string;
/** Collapse a path for display: replace the OS home with `~`. */
export declare function displayPath(input: string): string;
/**
 * Windows-safe comparison key for paths (case-insensitive there).
 */
export declare function pathKey(input: string): string;
/** Whether a host path contains a NUL byte or a control character. */
export declare function hasControlCharacters(input: string): boolean;
