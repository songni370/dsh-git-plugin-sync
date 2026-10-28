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
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
/** Conservative profile name validation (also blocks path traversal). */
const SAFE_PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Whether a value is a plain record (never a class instance or array). */
function isPlainRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
/** Normalize a dependency map, dropping non-string and empty specs. */
function normalizeDependencies(raw) {
    const dependencies = {};
    if (!isPlainRecord(raw))
        return dependencies;
    for (const [name, spec] of Object.entries(raw)) {
        if (name.trim() === '' || typeof spec !== 'string')
            continue;
        const trimmed = spec.trim();
        if (trimmed === '')
            continue;
        dependencies[name] = trimmed;
    }
    return dependencies;
}
/** Read bundle names a profile manifest declares under its `dsh` section. */
function collectDeclaredBundles(dsh) {
    if (!isPlainRecord(dsh))
        return [];
    const out = [];
    const push = (value) => {
        if (typeof value === 'string' && value.trim() !== '')
            out.push(value.trim());
    };
    const pushEntry = (value) => {
        if (typeof value === 'string')
            push(value);
        else if (isPlainRecord(value))
            push(value.name);
    };
    const bundles = dsh.bundles;
    if (Array.isArray(bundles))
        for (const item of bundles)
            pushEntry(item);
    const bundle = dsh.bundle;
    if (Array.isArray(bundle))
        for (const item of bundle)
            pushEntry(item);
    else
        pushEntry(bundle);
    return out;
}
/** Parse `<dir>/package.json`; null when missing, unreadable or malformed. */
async function readProfilePackage(dir) {
    let text;
    try {
        text = await readFile(join(dir, 'package.json'), 'utf8');
    }
    catch {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (!isPlainRecord(parsed))
        return null;
    return {
        dependencies: normalizeDependencies(parsed.dependencies),
        declaredBundles: collectDeclaredBundles(parsed.dsh),
    };
}
/** Merge dependency names with explicitly declared bundles, without duplicates. */
function mergeBundles(dependencies, declared) {
    const seen = new Set();
    const out = [];
    for (const name of [...dependencies, ...declared]) {
        if (seen.has(name))
            continue;
        seen.add(name);
        out.push(name);
    }
    return out;
}
/**
 * List the usable profiles under a DSH home's `profiles` directory.
 *
 * Directories without a readable `package.json` (broken or half-created
 * profiles) are ignored, and an unreadable root yields an empty list.
 */
export async function listProfiles(profilesRoot) {
    let entries;
    try {
        entries = await readdir(profilesRoot, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const summaries = [];
    for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink())
            continue;
        if (!SAFE_PROFILE_NAME.test(entry.name))
            continue;
        const dir = join(profilesRoot, entry.name);
        const pkg = await readProfilePackage(dir);
        if (pkg === null)
            continue;
        const bundles = mergeBundles(Object.keys(pkg.dependencies), pkg.declaredBundles);
        summaries.push({
            name: entry.name,
            dir,
            dependencies: pkg.dependencies,
            bundles,
            pluginCount: bundles.length,
        });
    }
    summaries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    return summaries;
}
/**
 * Resolve one profile directory, or null when the profile does not exist.
 * Rejects unsafe names before touching the filesystem.
 */
export async function findProfileDir(profilesRoot, name) {
    if (typeof name !== 'string')
        return null;
    const trimmed = name.trim();
    if (trimmed === '' || !SAFE_PROFILE_NAME.test(trimmed))
        return null;
    const dir = join(profilesRoot, trimmed);
    try {
        await readdir(dir);
        return dir;
    }
    catch {
        return null;
    }
}
/** Read only the dependency map of a profile; `{}` when unreadable or broken. */
export async function readProfileDependencies(dir) {
    const pkg = await readProfilePackage(dir);
    return pkg === null ? {} : pkg.dependencies;
}
