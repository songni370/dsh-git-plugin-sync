/**
 * Version comparison for plugin synchronization.
 *
 * Deliberately tolerant: a backup may contain a prerelease, a git-sourced
 * version, or nothing at all. Only clearly ordered semver values are compared;
 * anything else is reported as "different, order unknown" so the UI asks the
 * user instead of guessing.
 * @module core/version
 */
/** Parsed semantic version. */
export interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    prerelease: string[];
    raw: string;
}
/** Parse `1.2.3`, `v1.2.3`, `1.2.3-rc.1`, `1.2.3+build`. */
export declare function parseVersion(input: string | null | undefined): ParsedVersion | null;
/** Compare two versions: -1 (a<b), 0 (equal), 1 (a>b), null when unordered. */
export declare function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null;
/** Whether `candidate` is a newer version than `current`. */
export declare function isNewerVersion(candidate: string | null | undefined, current: string | null | undefined): boolean;
/** Whether a version string parses as semver. */
export declare function isValidVersion(input: string | null | undefined): boolean;
/** Human-readable relation between two versions. */
export declare function versionRelation(local: string | null | undefined, remote: string | null | undefined): 'same' | 'local-newer' | 'remote-newer' | 'different';
