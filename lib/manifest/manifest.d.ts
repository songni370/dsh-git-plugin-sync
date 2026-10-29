/**
 * Backup manifest: construction, validation and deterministic serialization.
 *
 * The manifest is the index of a backup repository, and the repository itself is
 * untrusted input: it may have been cloned from anywhere, or written by another
 * device running an older or newer version of this plugin. Every document read
 * from it therefore passes through a validator here, and a document that cannot
 * be understood is rejected with {@link SyncError} code `invalid-manifest`
 * instead of being silently repaired. A newer `schemaVersion` gets an explicit
 * "please upgrade the plugin" message, because migrating is a future release's
 * job, not a guess this release should make.
 *
 * Serialization is deterministic: keys are sorted recursively, rendered with
 * two-space indentation and a trailing newline, so writing identical data twice
 * produces byte-identical files and the "nothing changed" detection in
 * `RepoStore.write` stays reliable.
 * @module manifest/manifest
 */
import type { DeviceInfo, DeviceSnapshot, JsonValue, Manifest, PluginRecord, RemoteConfigEntry, RemotePluginEntry, RemoteProfileState } from '../types.js';
/** Generator recorded in the manifest; bumped with the plugin release. */
export declare const MANIFEST_GENERATOR: {
    readonly name: "dsh-plugins-git-sync";
    readonly version: "0.1.0";
};
/** Profile names and device ids become path segments; keep them simple. */
export declare const PROFILE_NAME_PATTERN: RegExp;
/** Device IDs become directory names; keep them to one conservative segment. */
export declare const DEVICE_ID_PATTERN: RegExp;
/** Whether a string is a safe single-segment profile name. */
export declare function isSafeProfileSegment(value: unknown): value is string;
/** Whether a string is a safe single-segment device id. */
export declare function isSafeDeviceId(value: unknown): value is string;
/** Whether a string is an ISO-8601 timestamp `.toISOString()` could produce. */
export declare function isValidTimestamp(value: unknown): value is string;
/**
 * Validate the schema version of a document read from the repository.
 * A newer version cannot be migrated by this release, so it fails with a clear
 * instruction instead of writing data an older plugin cannot read.
 * @throws {SyncError} code `invalid-manifest`.
 */
export declare function checkSchemaVersion(value: unknown, label: string): number;
/**
 * Validate an untrusted manifest document and return a normalized copy.
 *
 * Unknown top-level members are dropped (forward compatibility), while invalid
 * required members fail loudly. `profiles` and `devices` are normalized to
 * sorted order so serialization is deterministic.
 * @throws {SyncError} code `invalid-manifest`.
 */
export declare function validateManifest(value: unknown): Manifest;
/** Input for {@link buildManifest}. */
export interface BuildManifestInput {
    /** Running plugin version recorded in the manifest generator field. */
    generatorVersion?: string;
    /** Previous manifest (preserves `createdAt` and the generator identity). */
    previous: Manifest | null;
    /** Per-profile plugin counts and update times. */
    profiles: Record<string, {
        pluginCount: number;
        updatedAt: string;
    }>;
    /** Device ids with a snapshot in this repository. */
    devices: string[];
    /** Current time as an ISO-8601 string. */
    now: string;
}
/**
 * Build a fresh manifest for this write.
 *
 * `createdAt` is carried over from the previous manifest (the repository's real
 * creation time), while `updatedAt` is always the current time.
 */
export declare function buildManifest(input: BuildManifestInput): Manifest;
/**
 * Serialize arbitrary backup JSON deterministically: recursively sorted keys,
 * two-space indentation, trailing newline.
 * @throws {SyncError} code `internal` when the value is not lossless JSON.
 */
export declare function serializeJson(value: unknown): string;
/**
 * Serialize the root manifest.
 *
 * Uses the documented member order (schemaVersion first) and sorted profile /
 * device collections, so equal manifests serialize to identical bytes.
 */
export declare function serializeManifest(manifest: Manifest): string;
/**
 * The machine-readable layout document written to `metadata/schema.json`.
 *
 * It is deliberately self-describing: anyone who opens the repository without
 * the plugin can read the schema version, the directory layout and the commit
 * trailers. It contains no machine-specific paths.
 */
export declare function buildSchemaDocument(pluginVersion?: string): string;
/** Validate a profile's shared plugin state (`plugins.json`). */
export declare function validateRemoteProfileState(value: unknown): RemoteProfileState;
/** Validate one plugin entry in the shared profile state. */
export declare function validateRemotePluginEntry(value: unknown, expectedId?: string): RemotePluginEntry;
/** Validate one plugin config document. */
export declare function validateRemoteConfigEntry(value: unknown): RemoteConfigEntry;
/** Validate device identity metadata. */
export declare function validateDeviceInfo(value: unknown): DeviceInfo;
/** Validate one scanned plugin record (as stored in a device snapshot). */
export declare function validatePluginRecord(value: unknown): PluginRecord;
/** Validate one device snapshot document. */
export declare function validateDeviceSnapshot(value: unknown): DeviceSnapshot;
/** Input for {@link buildRemotePluginEntry}. */
export interface BuildRemotePluginEntryInput {
    /** Scanned plugin record. */
    record: PluginRecord;
    /** When the shared entry was produced. */
    updatedAt: string;
    /** Device id that produced the entry. */
    updatedBy: string;
    /** Mark the entry as a removal tombstone. */
    deleted?: boolean;
}
/** Build one shared profile-state entry from a scanned plugin record. */
export declare function buildRemotePluginEntry(input: BuildRemotePluginEntryInput): RemotePluginEntry;
/** Input for {@link buildRemoteProfileState}. */
export interface BuildRemoteProfileStateInput {
    profile: string;
    /** Entries as an array or already keyed by plugin id. */
    plugins: readonly RemotePluginEntry[] | Record<string, RemotePluginEntry>;
    updatedAt: string;
}
/** Build one profile's shared state document. */
export declare function buildRemoteProfileState(input: BuildRemoteProfileStateInput): RemoteProfileState;
/** Input for {@link buildRemoteConfigEntry}. */
export interface BuildRemoteConfigEntryInput {
    pluginId: string;
    configs: Record<string, JsonValue>;
    updatedAt: string;
    updatedBy: string;
}
/** Build one plugin config document. */
export declare function buildRemoteConfigEntry(input: BuildRemoteConfigEntryInput): RemoteConfigEntry;
/** Input for {@link buildDeviceSnapshot}. */
export interface BuildDeviceSnapshotInput {
    device: DeviceInfo;
    profile: string;
    plugins: readonly PluginRecord[];
    updatedAt: string;
}
/** Build one device snapshot document. */
export declare function buildDeviceSnapshot(input: BuildDeviceSnapshotInput): DeviceSnapshot;
/** Parse repository JSON, mapping a syntax error to `invalid-manifest`. */
export declare function parseRepoJson(text: string, label: string): unknown;
/** Parse and validate the root manifest file. */
export declare function parseManifestJson(text: string): Manifest;
/** Parse and validate a `plugins.json` file. */
export declare function parseRemoteProfileStateJson(text: string): RemoteProfileState;
/** Parse and validate a config file. */
export declare function parseRemoteConfigEntryJson(text: string): RemoteConfigEntry;
/** Parse and validate a device snapshot file. */
export declare function parseDeviceSnapshotJson(text: string): DeviceSnapshot;
