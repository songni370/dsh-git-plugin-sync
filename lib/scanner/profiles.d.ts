/**
 * Profile discovery and profile-manifest reading.
 *
 * A DSH home keeps one directory per profile under `<DSH home>/profiles`. Each
 * one is a small package whose `dependencies` are the plugins installed into
 * that profile; the same directory is the fallback inventory source when the
 * Host's plugin manager is unavailable. Everything here parses defensively:
 * a profile that a previous install left broken is skipped, never fatal.
 * @module scanner/profiles
 */
/** One profile the settings page can offer in its selector. */
export interface ProfileSummary {
    /** Directory name, which is also the profile name. */
    name: string;
    /** Absolute profile directory. */
    dir: string;
    /** `dependencies` map from the profile's `package.json` (plugin name -> spec). */
    dependencies: Record<string, string>;
    /**
     * Installed plugin/bundle package names: the dependency names, plus any
     * bundle names the profile manifest declares explicitly under `dsh`.
     */
    bundles: string[];
    /** Number of known bundles, for the selector's badge. */
    pluginCount: number;
}
/**
 * List the usable profiles under a DSH home's `profiles` directory.
 *
 * Directories without a readable `package.json` (broken or half-created
 * profiles) are ignored, and an unreadable root yields an empty list.
 */
export declare function listProfiles(profilesRoot: string): Promise<ProfileSummary[]>;
/**
 * Resolve one profile directory, or null when the profile does not exist.
 * Rejects unsafe names before touching the filesystem.
 */
export declare function findProfileDir(profilesRoot: string, name: string): Promise<string | null>;
/** Read only the dependency map of a profile; `{}` when unreadable or broken. */
export declare function readProfileDependencies(dir: string): Promise<Record<string, string>>;
