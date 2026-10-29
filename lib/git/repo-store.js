/**
 * Backup repository store: clone, read, write, commit and push.
 *
 * This is the only module that touches the Git work tree. It owns three
 * invariants the rest of the plugin relies on:
 *
 * - **The work tree is a cache.** `prepare()` clones it if needed and resets it
 *   to `origin/<branch>`, so a half-finished earlier run never leaks into a new
 *   backup. Reads always come from that refreshed work tree; `readAtCommit()`
 *   reads a historical revision through `git show` without touching it.
 * - **Writes are transactions.** Files are written atomically inside the backup
 *   directory, deletions are applied first, then a single commit with the
 *   plugin's trailers is created. Nothing is committed when the tree is already
 *   identical (`changed: false`), which keeps the history meaningful.
 * - **Pushes never force.** A non-fast-forward rejection is resolved by
 *   fetching, resetting, calling the caller's `rebuild` hook and retrying; after
 *   the retry budget it fails with a retryable `git-push-rejected` instead of
 *   overwriting another device's work.
 *
 * All paths are validated by `repo-paths`, which refuses parent traversal,
 * absolute paths, `.git`, and symlinked directories.
 * @module git/repo-store
 */
import { lstat, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { HISTORY_LIMIT, MAX_BACKUP_FILES, REPO_README_FILE } from '../constants.js';
import { SyncError, errorMessage } from '../core/errors.js';
import { expandHomePath, isSafeRelativePath, repoPath } from '../core/paths.js';
import { redactText } from '../core/redact.js';
import { parseDeviceSnapshotJson, parseManifestJson, parseRemoteConfigEntryJson, parseRemoteProfileStateJson, isSafeDeviceId, } from '../manifest/manifest.js';
import { isSafeBranchName, validateRepoUrl } from '../state/store.js';
import { classifyGitFailure } from './git-runner.js';
import { assertProfileName, backupPaths, configsDirPath, deleteWorkTreeFile, deviceSnapshotPath, devicesDirPath, manifestPath, normalizeBackupDirectory, profileStatePath, resolveTarget, workTreePath, writeWorkTreeFile, readRepoFile, listRepoDirectory, assertDeviceId, } from './repo-paths.js';
export { backupPaths };
/** README written into a fresh backup repository. Contains no absolute paths. */
export const BACKUP_README = `# DSH 插件 Git 同步 — 备份仓库 / DSH Plugin Git Sync — Backup Repository

此仓库由 DSH 插件「DSH 插件 Git 同步」自动维护，请勿手工修改。
This repository is maintained automatically by the DSH "DSH Plugin Git Sync" plugin. Do not edit it by hand: local changes may be overwritten by the next synchronization.

- \`manifest.json\` — 备份索引 / index of the backup
- \`metadata/schema.json\` — 布局与 schema 版本说明 / layout and schema version
- \`profiles/<profile>/plugins.json\` — 共享插件状态 / shared plugin state per profile
- \`profiles/<profile>/configs/<plugin-id>.json\` — 非敏感配置 / non-secret configuration
- \`devices/<deviceId>/<profile>.json\` — 设备快照 / device snapshot

恢复与同步请使用插件设置页或 Agent 工具。/ Use the plugin settings page or agent tools to restore or synchronize.
`;
/** Canonical trailer names written into commit bodies. */
const TRAILER_NAMES = {
    operation: 'Operation',
    deviceId: 'Device-Id',
    deviceName: 'Device-Name',
    profile: 'Profile',
    result: 'Result',
    pluginCount: 'Plugin-Count',
};
/** Sanitize one trailer value to a single short line. */
function sanitizeTrailerValue(value) {
    const line = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return line.length > 500 ? line.slice(0, 500) : line;
}
/** Sanitize one trailer key; unknown keys are only kept when they are valid. */
function sanitizeTrailerKey(key) {
    const canonical = TRAILER_NAMES[key] ?? key;
    return /^[A-Za-z][A-Za-z0-9-]{0,40}$/.test(canonical) ? canonical : '';
}
/**
 * Format the trailer paragraph of a backup commit.
 *
 * `CommitTrailers` keys are mapped to their documented trailer names
 * (`deviceId` → `Device-Id`, ...); one `Key: value` line is emitted per trailer
 * so `git interpret-trailers` and the history parser both read them.
 */
export function formatCommitTrailers(trailers) {
    const lines = [];
    const written = new Set();
    for (const [property, name] of Object.entries(TRAILER_NAMES)) {
        const value = trailers[property];
        if (typeof value !== 'string' || value === '')
            continue;
        const safeValue = sanitizeTrailerValue(value);
        if (safeValue === '')
            continue;
        lines.push(`${name}: ${safeValue}`);
        written.add(property);
    }
    for (const [property, value] of Object.entries(trailers)) {
        if (written.has(property) || typeof value !== 'string' || value === '')
            continue;
        const key = sanitizeTrailerKey(property);
        const safeValue = sanitizeTrailerValue(value);
        if (key === '' || safeValue === '')
            continue;
        lines.push(`${key}: ${safeValue}`);
    }
    return lines.join('\n');
}
/** Parse a commit body's trailer paragraph (tolerates a missing paragraph). */
export function parseCommitTrailers(body) {
    const trailers = {};
    if (typeof body !== 'string' || body === '')
        return trailers;
    const lines = body.split(/\r?\n/);
    // `%B` ends with a newline (and a body may contain several), so blank lines at
    // both ends are not part of the trailer block.
    while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '')
        lines.pop();
    while (lines.length > 0 && (lines[0] ?? '').trim() === '')
        lines.shift();
    // A trailer block only counts when it is the last paragraph: Git separates it
    // from the subject with a blank line.
    let start = -1;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if ((lines[index] ?? '').trim() === '') {
            start = index + 1;
            break;
        }
    }
    if (start < 0)
        return trailers;
    for (let index = start; index < lines.length; index += 1) {
        const match = /^([A-Za-z][A-Za-z0-9-]{0,40}):\s*(.*)$/.exec((lines[index] ?? '').trim());
        if (match === null)
            continue;
        const key = (match[1] ?? '').toLowerCase();
        const value = (match[2] ?? '').trim();
        if (key !== '')
            trailers[key] = value;
    }
    return trailers;
}
/** Parse `git log` output produced with the history format string. */
export function parseHistoryLog(stdout) {
    const entries = [];
    for (const rawRecord of stdout.split('\x1e')) {
        const record = rawRecord.replace(/^\r?\n/, '');
        if (record.trim() === '')
            continue;
        const fields = record.split('\x00');
        if (fields.length < 6)
            continue;
        const commit = fields[0] ?? '';
        const shortCommit = fields[1] ?? '';
        const date = fields[2] ?? '';
        const author = fields[3] ?? '';
        const subject = fields[4] ?? '';
        const body = fields.slice(5).join('\x00');
        if (commit === '')
            continue;
        const trailers = parseCommitTrailers(body);
        const entry = {
            commit,
            shortCommit,
            date,
            author,
            subject,
            operation: trailers.operation ?? 'unknown',
        };
        const deviceId = trailers['device-id'] ?? trailers.deviceid;
        if (deviceId !== undefined && deviceId !== '')
            entry.deviceId = deviceId;
        const deviceName = trailers['device-name'] ?? trailers.devicename;
        if (deviceName !== undefined && deviceName !== '')
            entry.deviceName = deviceName;
        if (trailers.profile !== undefined && trailers.profile !== '')
            entry.profile = trailers.profile;
        const pluginCount = trailers['plugin-count'] ?? trailers.plugincount;
        if (pluginCount !== undefined && /^\d+$/.test(pluginCount))
            entry.pluginCount = Number.parseInt(pluginCount, 10);
        if (trailers.result !== undefined && trailers.result !== '')
            entry.result = trailers.result;
        entries.push(entry);
    }
    return entries;
}
/** Normalize a repository URL: local paths become absolute. */
function normalizeRepoUrl(raw) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw))
        return raw;
    if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/.test(raw))
        return raw;
    return resolve(expandHomePath(raw));
}
/** Whether a failed fetch only means "the branch does not exist on the remote". */
function isMissingRemoteRef(result) {
    return /(?:couldn't|could not|no such) (?:find )?remote ref/i.test(`${result.stderr}\n${result.stdout}`);
}
/** Whether a failed `git show`/`git ls-tree` only means "path absent at commit". */
function isMissingPathInTree(result) {
    return /does not exist in|exists on disk, but not in|path .* does not exist/i.test(`${result.stderr}\n${result.stdout}`);
}
/** Whether a rejected push raced another device (and may be retried). */
function isNonFastForwardPush(result) {
    const text = `${result.stderr}\n${result.stdout}`;
    if (/remote rejected|pre-receive hook|hook declined|protected branch|GH006|GH013/i.test(text))
        return false;
    return /non-fast-forward|fetch first|updates were rejected|failed to push some refs|\[rejected\]/i.test(text);
}
/** Parse `git status --porcelain -z` output into repository-relative paths. */
export function parsePorcelainZ(stdout) {
    const tokens = stdout.split('\x00');
    const paths = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index] ?? '';
        if (token.length < 4)
            continue;
        const status = token.slice(0, 2);
        const path = token.slice(3);
        // Rename/copy entries carry the original path in a following token.
        if (status.startsWith('R') || status.startsWith('C'))
            index += 1;
        if (path !== '')
            paths.push(path);
    }
    return paths;
}
/** The trailer-derived author identity used for backup commits. */
function commitEnvironment(trailers) {
    const rawName = typeof trailers.deviceName === 'string' ? trailers.deviceName : '';
    const name = rawName
        .replace(/[\u0000-\u001f\u007f<>]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 64);
    const authorName = name === '' ? 'DSH Plugin Git Sync' : name;
    const rawId = typeof trailers.deviceId === 'string' ? trailers.deviceId : '';
    const authorEmail = `${/^[A-Za-z0-9._-]{1,64}$/.test(rawId) ? rawId : 'device'}@dsh-plugins-git-sync.local`;
    return {
        GIT_AUTHOR_NAME: authorName,
        GIT_AUTHOR_EMAIL: authorEmail,
        GIT_COMMITTER_NAME: authorName,
        GIT_COMMITTER_EMAIL: authorEmail,
    };
}
/**
 * Create the backup repository store.
 *
 * Configuration is validated lazily: constructing a store never throws, so the
 * plugin can create it at startup and surface a `not-configured` error only when
 * an operation actually needs the repository.
 */
export function createRepoStore(options) {
    const logger = options.logger;
    const workDir = resolve(options.workDir);
    const maxPushRetries = options.maxPushRetries !== undefined && Number.isInteger(options.maxPushRetries) && options.maxPushRetries >= 0
        ? Math.min(options.maxPushRetries, 10)
        : 3;
    let cachedSettings = null;
    const settings = () => {
        if (cachedSettings !== null)
            return cachedSettings;
        const rawUrl = (options.repoUrl ?? '').trim();
        if (rawUrl === '') {
            throw new SyncError('not-configured', '尚未配置备份仓库 / the backup repository is not configured');
        }
        let repoUrl;
        try {
            repoUrl = validateRepoUrl(rawUrl);
        }
        catch (error) {
            if (error instanceof SyncError)
                throw error;
            throw new SyncError('invalid-config', `仓库地址无效 / invalid repository URL: ${redactText(String(rawUrl))}`);
        }
        if (repoUrl === '') {
            throw new SyncError('not-configured', '尚未配置备份仓库 / the backup repository is not configured');
        }
        if (repoUrl.startsWith('-')) {
            throw new SyncError('invalid-config', '仓库地址不能以 - 开头 / the repository URL must not start with -');
        }
        if (!isSafeBranchName(options.branch)) {
            throw new SyncError('invalid-config', `分支名无效 / invalid branch name: ${JSON.stringify(options.branch)}`);
        }
        const backupDir = normalizeBackupDirectory(options.backupDir);
        cachedSettings = { repoUrl: normalizeRepoUrl(repoUrl), branch: options.branch, backupDir };
        return cachedSettings;
    };
    let preparedOnce = false;
    let prepareInFlight = null;
    let preparing = null;
    let headCache;
    /** Turn a failed Git result into a typed error. */
    const gitFailure = (result) => classifyGitFailure(result.stderr.length > 0 ? result.stderr : result.stdout, result.timedOut);
    /** Run one Git command in the work tree; throw unless failure is expected. */
    const runGit = async (args, runOptions = {}) => {
        const result = await options.run.run(args, {
            cwd: runOptions.cwd ?? workDir,
            env: runOptions.env,
            signal: runOptions.signal,
        });
        if (result.code !== 0)
            throw gitFailure(result);
        return result;
    };
    /** Current HEAD, cached because this module owns the work tree. */
    const readHead = async () => {
        if (headCache !== undefined)
            return headCache;
        const result = await options.run.run(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: workDir });
        headCache = result.code === 0 && result.stdout.trim() !== '' ? result.stdout.trim() : null;
        return headCache;
    };
    /** Re-read HEAD after a command that may have moved it. */
    const refreshHead = async () => {
        headCache = undefined;
        return await readHead();
    };
    /** Whether the work directory is already a Git work tree. */
    const isGitRepository = async () => {
        try {
            const stats = await stat(join(workDir, '.git'));
            return stats.isDirectory() || stats.isFile();
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return false;
            throw error;
        }
    };
    /** Clone/fetch/reset to the remote branch (the implementation of `prepare`). */
    const performPrepare = async (signal) => {
        const { repoUrl, branch } = settings();
        await mkdir(workDir, { recursive: true, mode: 0o700 });
        const existed = await isGitRepository();
        let hadLocalBranch = false;
        if (existed) {
            const verify = await options.run.run(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
                cwd: workDir,
                signal,
            });
            hadLocalBranch = verify.code === 0;
        }
        else {
            const entries = await readdir(workDir);
            if (entries.length > 0) {
                throw new SyncError('invalid-path', `工作目录非空且不是 Git 仓库 / work directory is not empty and is not a git repository: ${workDir}`);
            }
            logger.info('cloning backup repository', { branch });
            const clone = await options.run.run(['clone', '--no-checkout', '--origin', 'origin', repoUrl, workDir], {
                cwd: dirname(workDir),
                signal,
            });
            if (clone.code !== 0) {
                logger.warn('git clone failed', { code: clone.code });
                throw gitFailure(clone);
            }
        }
        const setUrl = await options.run.run(['remote', 'set-url', 'origin', repoUrl], { cwd: workDir, signal });
        if (setUrl.code !== 0) {
            const addRemote = await options.run.run(['remote', 'add', 'origin', repoUrl], { cwd: workDir, signal });
            if (addRemote.code !== 0)
                throw gitFailure(addRemote);
        }
        const remoteRef = `refs/remotes/origin/${branch}`;
        const refspec = `+refs/heads/${branch}:${remoteRef}`;
        const fetchResult = await options.run.run(['fetch', '--prune', 'origin', refspec], { cwd: workDir, signal });
        let originExists = false;
        if (fetchResult.code === 0) {
            originExists = true;
        }
        else if (isMissingRemoteRef(fetchResult)) {
            // First backup (or the remote branch was deleted): drop any stale
            // remote-tracking ref so the emptiness check below is honest.
            await options.run.run(['update-ref', '-d', remoteRef], { cwd: workDir, signal });
            originExists = false;
        }
        else {
            throw gitFailure(fetchResult);
        }
        let refreshed = false;
        if (originExists) {
            const reset = await options.run.run(['reset', '--hard', remoteRef], { cwd: workDir, signal });
            if (reset.code !== 0)
                throw gitFailure(reset);
            const checkout = await options.run.run(['checkout', '-B', branch, remoteRef], { cwd: workDir, signal });
            if (checkout.code !== 0)
                throw gitFailure(checkout);
            refreshed = true;
        }
        else {
            const checkout = await options.run.run(['checkout', '-B', branch], { cwd: workDir, signal });
            if (checkout.code !== 0)
                throw gitFailure(checkout);
        }
        const head = await refreshHead();
        const created = !hadLocalBranch && !originExists;
        logger.info('backup repository ready', { branch, head, created, refreshed });
        return { head, created, branch, refreshed };
    };
    /** Fetch the remote branch and reset the work tree to it. */
    const refreshFromRemote = async (signal) => {
        const { branch } = settings();
        const remoteRef = `refs/remotes/origin/${branch}`;
        const refspec = `+refs/heads/${branch}:${remoteRef}`;
        const fetchResult = await options.run.run(['fetch', '--prune', 'origin', refspec], { cwd: workDir, signal });
        if (fetchResult.code !== 0 && !isMissingRemoteRef(fetchResult))
            throw gitFailure(fetchResult);
        if (fetchResult.code === 0) {
            const reset = await options.run.run(['reset', '--hard', remoteRef], { cwd: workDir, signal });
            if (reset.code !== 0)
                throw gitFailure(reset);
            const checkout = await options.run.run(['checkout', '-B', branch, remoteRef], { cwd: workDir, signal });
            if (checkout.code !== 0)
                throw gitFailure(checkout);
            const head = await refreshHead();
            return { head, refreshed: true };
        }
        await options.run.run(['update-ref', '-d', remoteRef], { cwd: workDir, signal });
        const head = await refreshHead();
        return { head, refreshed: false };
    };
    const prepare = async (prepareOptions = {}) => {
        if (prepareInFlight !== null) {
            try {
                await prepareInFlight;
            }
            catch {
                // A previous attempt failed; this call performs its own attempt.
            }
        }
        const task = performPrepare(prepareOptions.signal);
        prepareInFlight = task;
        try {
            const result = await task;
            preparedOnce = true;
            return result;
        }
        finally {
            if (prepareInFlight === task)
                prepareInFlight = null;
        }
    };
    const ensurePrepared = async (signal) => {
        if (preparedOnce)
            return;
        if (preparing === null) {
            const run = prepare({ signal });
            preparing = run
                .then(() => {
                preparedOnce = true;
            })
                .finally(() => {
                preparing = null;
            });
        }
        await preparing;
    };
    /** Normalize the caller's file map to safe, unique repository paths. */
    const normalizeFiles = (backupDir, files) => {
        if (files === null || typeof files !== 'object' || Array.isArray(files)) {
            throw new SyncError('invalid-path', '备份文件必须是对象 / backup files must be an object');
        }
        const entries = Object.entries(files);
        if (entries.length > MAX_BACKUP_FILES) {
            throw new SyncError('invalid-config', `备份文件数量超过上限 ${MAX_BACKUP_FILES} / too many backup files (limit ${MAX_BACKUP_FILES})`);
        }
        const out = [];
        const seen = new Set();
        for (const [path, content] of entries) {
            if (typeof content !== 'string') {
                throw new SyncError('invalid-path', `备份文件内容必须是字符串 / backup file content must be a string: ${JSON.stringify(path)}`);
            }
            const target = resolveTarget(backupDir, path);
            if (seen.has(target.repo)) {
                throw new SyncError('invalid-path', `重复的备份路径 / duplicate backup path: ${target.repo}`);
            }
            seen.add(target.repo);
            out.push({ repo: target.repo, backup: target.backup, content });
        }
        return out;
    };
    /** Normalize the caller's deletion list. */
    const normalizeDeletions = (backupDir, deletions) => {
        if (deletions === undefined)
            return [];
        if (!Array.isArray(deletions)) {
            throw new SyncError('invalid-path', 'deletions 必须是数组 / deletions must be an array');
        }
        if (deletions.length > MAX_BACKUP_FILES) {
            throw new SyncError('invalid-config', `删除文件数量超过上限 / too many deletions (limit ${MAX_BACKUP_FILES})`);
        }
        const out = [];
        const seen = new Set();
        for (const path of deletions) {
            const target = resolveTarget(backupDir, path);
            if (seen.has(target.repo))
                continue;
            seen.add(target.repo);
            out.push({ repo: target.repo, backup: target.backup });
        }
        return out;
    };
    /** Accept both rebuild() return shapes (plain map, or files + deletions). */
    const normalizeRebuild = (rebuild) => {
        if (rebuild === undefined)
            return undefined;
        return async (workTree) => {
            const result = (await rebuild(workTree));
            if (result !== null && typeof result === 'object' && 'files' in result) {
                const rawFiles = result.files;
                const rawDeletions = result.deletions;
                if (rawFiles === null || typeof rawFiles !== 'object' || Array.isArray(rawFiles)) {
                    throw new SyncError('internal', 'rebuild() 必须返回文件映射 / rebuild() must return a file map');
                }
                if (rawDeletions !== undefined && !Array.isArray(rawDeletions)) {
                    throw new SyncError('internal', 'rebuild().deletions 必须是数组 / rebuild().deletions must be an array');
                }
                const deletions = Array.isArray(rawDeletions)
                    ? rawDeletions.filter((value) => typeof value === 'string')
                    : [];
                return { files: rawFiles, deletions };
            }
            return { files: result };
        };
    };
    /** Write and commit the desired tree; returns what actually changed. */
    const materialize = async (backupDir, inputFiles, inputDeletions, writeOptions) => {
        const files = [...inputFiles];
        const deletions = [...inputDeletions];
        const explicit = new Set(files.map(file => file.repo));
        const deleted = new Set(deletions.map(deletion => deletion.repo));
        // The warning README is created on the first write (and whenever it is
        // missing); an explicit file or deletion from the caller always wins.
        const readmeRepoPath = repoPath(backupDir, REPO_README_FILE);
        if (!explicit.has(readmeRepoPath) && !deleted.has(readmeRepoPath)) {
            const existing = await readRepoFile(workDir, readmeRepoPath);
            if (existing === null)
                files.push({ repo: readmeRepoPath, backup: REPO_README_FILE, content: BACKUP_README });
        }
        if (writeOptions.dryRun) {
            const changed = new Set();
            for (const file of files) {
                const existing = await readRepoFile(workDir, file.repo);
                if (existing !== file.content)
                    changed.add(file.repo);
            }
            for (const deletion of deletions) {
                if (await pathExists(workTreePath(workDir, deletion.repo)))
                    changed.add(deletion.repo);
            }
            const changedFiles = [...changed].sort();
            return { changed: changedFiles.length > 0, changedFiles, commit: await readHead() };
        }
        for (const deletion of deletions)
            await deleteWorkTreeFile(workDir, deletion.repo);
        for (const file of files)
            await writeWorkTreeFile(workDir, file.repo, file.content);
        await runGit(['add', '-A'], { signal: writeOptions.signal });
        const status = await runGit(['status', '--porcelain', '-z'], { signal: writeOptions.signal });
        const changedFiles = parsePorcelainZ(status.stdout);
        if (changedFiles.length === 0) {
            return { changed: false, changedFiles: [], commit: await readHead() };
        }
        const body = formatCommitTrailers(writeOptions.trailers);
        const commitArgs = ['commit', '--no-verify', '-m', writeOptions.subject];
        if (body !== '')
            commitArgs.push('-m', body);
        const commit = await options.run.run(commitArgs, {
            cwd: workDir,
            env: commitEnvironment(writeOptions.trailers),
            signal: writeOptions.signal,
        });
        if (commit.code !== 0)
            throw gitFailure(commit);
        const head = await refreshHead();
        return { changed: true, changedFiles, commit: head };
    };
    /** Sanitize the commit subject to one non-empty line. */
    const commitSubject = (message) => {
        const line = (typeof message === 'string' ? message : '')
            .replace(/[\u0000-\u001f\u007f]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return line === '' ? 'DSH 插件备份 / DSH plugin backup' : line.slice(0, 200);
    };
    const write = async (writeOptions) => {
        await ensurePrepared(writeOptions.signal);
        const { backupDir, branch } = settings();
        let files = normalizeFiles(backupDir, writeOptions.files);
        let deletions = normalizeDeletions(backupDir, writeOptions.deletions);
        const rebuild = normalizeRebuild(writeOptions.rebuild);
        const dryRun = writeOptions.dryRun === true;
        const subject = commitSubject(writeOptions.message);
        let retried = false;
        let attempt = 0;
        for (;;) {
            if (attempt > 0) {
                const refreshed = await refreshFromRemote(writeOptions.signal);
                if (rebuild !== undefined) {
                    const rebuilt = await rebuild(workDir);
                    files = normalizeFiles(backupDir, rebuilt.files);
                    deletions = normalizeDeletions(backupDir, rebuilt.deletions);
                }
                logger.warn('retrying backup write after a concurrent update', {
                    attempt,
                    refreshed: refreshed.refreshed,
                });
            }
            const outcome = await materialize(backupDir, files, deletions, {
                dryRun,
                subject,
                trailers: writeOptions.trailers,
                signal: writeOptions.signal,
            });
            if (dryRun) {
                return {
                    changed: outcome.changed,
                    pushed: false,
                    commit: outcome.commit,
                    changedFiles: outcome.changedFiles,
                    retried,
                };
            }
            if (!outcome.changed) {
                return { changed: false, pushed: false, commit: outcome.commit, changedFiles: [], retried };
            }
            const push = await options.run.run(['push', 'origin', `HEAD:refs/heads/${branch}`], {
                cwd: workDir,
                signal: writeOptions.signal,
            });
            if (push.code === 0) {
                logger.info('backup pushed', {
                    commit: outcome.commit,
                    changedFiles: outcome.changedFiles.length,
                    retried,
                });
                return {
                    changed: true,
                    pushed: true,
                    commit: outcome.commit,
                    changedFiles: outcome.changedFiles,
                    retried,
                };
            }
            if (!isNonFastForwardPush(push))
                throw gitFailure(push);
            retried = true;
            if (attempt >= maxPushRetries) {
                throw new SyncError('git-push-rejected', `仓库正在被其他设备并发更新，已重试 ${maxPushRetries} 次仍无法推送 / the repository is being updated by another device; the push was still rejected after ${maxPushRetries} retries`, { retryable: true, details: { attempts: attempt + 1 } });
            }
            logger.warn('push rejected; re-synchronizing before retry', { attempt: attempt + 1 });
            attempt += 1;
        }
    };
    const history = async (historyOptions = {}) => {
        await ensurePrepared(historyOptions.signal);
        if ((await readHead()) === null)
            return [];
        const requested = historyOptions.limit ?? HISTORY_LIMIT;
        const limit = Number.isFinite(requested) ? Math.min(1_000, Math.max(1, Math.trunc(requested))) : HISTORY_LIMIT;
        const format = '%H%x00%h%x00%aI%x00%an%x00%s%x00%B%x1e';
        const result = await runGit(['log', '-n', String(limit), `--format=${format}`], { signal: historyOptions.signal });
        return parseHistoryLog(result.stdout);
    };
    const readManifest = async () => {
        await ensurePrepared();
        const { backupDir } = settings();
        if ((await readHead()) === null)
            return null;
        const text = await readRepoFile(workDir, manifestPath(backupDir));
        if (text === null)
            return null;
        return parseManifestJson(text);
    };
    const readProfileState = async (profile) => {
        await ensurePrepared();
        const { backupDir } = settings();
        assertProfileName(profile);
        if ((await readHead()) === null)
            return null;
        const text = await readRepoFile(workDir, profileStatePath(backupDir, profile));
        if (text === null)
            return null;
        return parseRemoteProfileStateJson(text);
    };
    const readConfigs = async (profile) => {
        await ensurePrepared();
        const { backupDir } = settings();
        assertProfileName(profile);
        const dir = configsDirPath(backupDir, profile);
        const entries = await listRepoDirectory(workDir, dir);
        if (entries === null || (await readHead()) === null)
            return {};
        const configs = {};
        for (const entry of entries) {
            if (entry.isSymbolicLink()) {
                throw new SyncError('invalid-manifest', '备份仓库包含符号链接配置文件 / backup repository contains a symlinked config file');
            }
            if (!entry.isFile() || !entry.name.endsWith('.json'))
                continue;
            const text = await readRepoFile(workDir, repoPath(dir, entry.name));
            if (text === null)
                continue;
            const parsed = parseRemoteConfigEntryJson(text);
            const key = parsed.pluginId !== '' ? parsed.pluginId : entry.name.slice(0, -5);
            configs[key] = parsed.configs;
        }
        return configs;
    };
    const readDeviceSnapshots = async () => {
        await ensurePrepared();
        const { backupDir } = settings();
        const root = devicesDirPath(backupDir);
        const deviceDirs = await listRepoDirectory(workDir, root);
        if (deviceDirs === null || (await readHead()) === null)
            return {};
        const snapshots = {};
        for (const deviceDir of deviceDirs) {
            if (deviceDir.isSymbolicLink()) {
                throw new SyncError('invalid-manifest', '备份仓库包含符号链接设备目录 / backup repository contains a symlinked device directory');
            }
            if (!deviceDir.isDirectory() || !isSafeDeviceId(deviceDir.name))
                continue;
            const deviceRoot = repoPath(root, deviceDir.name);
            const profileFiles = await listRepoDirectory(workDir, deviceRoot);
            if (profileFiles === null)
                continue;
            for (const profileFile of profileFiles) {
                if (profileFile.isSymbolicLink()) {
                    throw new SyncError('invalid-manifest', '备份仓库包含符号链接快照文件 / backup repository contains a symlinked snapshot file');
                }
                if (!profileFile.isFile() || !profileFile.name.endsWith('.json'))
                    continue;
                const text = await readRepoFile(workDir, repoPath(deviceRoot, profileFile.name));
                if (text === null)
                    continue;
                const snapshot = parseDeviceSnapshotJson(text);
                snapshots[snapshot.device.id] = snapshot;
            }
        }
        return snapshots;
    };
    /** `git show <rev>:<path>`; null when the path does not exist at that revision. */
    const showAtRevision = async (revision, repoRelative, signal) => {
        if (!isSafeRelativePath(repoRelative)) {
            throw new SyncError('invalid-path', `不安全的仓库路径 / unsafe repository path: ${JSON.stringify(repoRelative)}`);
        }
        const result = await options.run.run(['show', `${revision}:${repoRelative}`], { cwd: workDir, signal });
        if (result.code === 0)
            return result.stdout;
        if (isMissingPathInTree(result))
            return null;
        throw gitFailure(result);
    };
    /** Validate a commit hash so it cannot be mistaken for a Git option. */
    const assertRevision = (commit) => {
        if (typeof commit !== 'string' || !/^[0-9a-fA-F]{4,64}$/.test(commit)) {
            throw new SyncError('invalid-path', `非法的提交哈希 / invalid commit hash: ${JSON.stringify(commit)}`);
        }
        return commit;
    };
    const deviceAtRevision = async (revision, profile, backupDir, signal) => {
        const readSnapshotDevice = async (repoRelative) => {
            const text = await showAtRevision(revision, repoRelative, signal);
            if (text === null)
                return null;
            return parseDeviceSnapshotJson(text).device;
        };
        if (options.deviceId !== undefined && options.deviceId !== '') {
            const deviceId = assertDeviceId(options.deviceId);
            return await readSnapshotDevice(deviceSnapshotPath(backupDir, deviceId, profile));
        }
        const root = devicesDirPath(backupDir);
        const listing = await options.run.run(['ls-tree', '--name-only', '-z', revision, '--', `${root}/`], {
            cwd: workDir,
            signal,
        });
        if (listing.code !== 0) {
            if (isMissingPathInTree(listing))
                return null;
            throw gitFailure(listing);
        }
        let chosen = null;
        for (const entry of listing.stdout.split('\x00')) {
            if (entry === '')
                continue;
            if (!isSafeRelativePath(entry))
                continue;
            const prefix = root === '' ? '' : `${root}/`;
            if (!entry.startsWith(prefix))
                continue;
            const relative = entry.slice(prefix.length);
            if (relative.includes('/') || !isSafeDeviceId(relative))
                continue;
            const text = await showAtRevision(revision, repoPath(root, relative, `${profile}.json`), signal);
            if (text === null)
                continue;
            const snapshot = parseDeviceSnapshotJson(text);
            if (chosen === null || snapshot.updatedAt > chosen.updatedAt) {
                chosen = { device: snapshot.device, updatedAt: snapshot.updatedAt };
            }
        }
        return chosen === null ? null : chosen.device;
    };
    const readAtCommit = async (commit, profile) => {
        await ensurePrepared();
        const { backupDir } = settings();
        assertProfileName(profile);
        const revision = assertRevision(commit);
        const manifestText = await showAtRevision(revision, manifestPath(backupDir));
        const stateText = await showAtRevision(revision, profileStatePath(backupDir, profile));
        const configs = {};
        const configsDir = configsDirPath(backupDir, profile);
        const listing = await options.run.run(['ls-tree', '--name-only', '-z', revision, '--', `${configsDir}/`], {
            cwd: workDir,
        });
        if (listing.code !== 0 && !isMissingPathInTree(listing))
            throw gitFailure(listing);
        if (listing.code === 0) {
            const prefix = configsDir === '' ? '' : `${configsDir}/`;
            for (const entry of listing.stdout.split('\x00')) {
                if (entry === '' || !entry.startsWith(prefix) || !entry.endsWith('.json'))
                    continue;
                if (!isSafeRelativePath(entry)) {
                    throw new SyncError('invalid-manifest', `不安全的配置路径 / unsafe config path: ${JSON.stringify(entry)}`);
                }
                const text = await showAtRevision(revision, entry);
                if (text === null)
                    continue;
                const parsed = parseRemoteConfigEntryJson(text);
                const key = parsed.pluginId !== '' ? parsed.pluginId : entry.slice(entry.lastIndexOf('/') + 1, -5);
                configs[key] = parsed.configs;
            }
        }
        const device = await deviceAtRevision(revision, profile, backupDir);
        return {
            manifest: manifestText === null ? null : parseManifestJson(manifestText),
            state: stateText === null ? null : parseRemoteProfileStateJson(stateText),
            configs,
            device,
        };
    };
    /** Authentication label for the connection test; never includes a secret. */
    const authMethodLabel = () => {
        if (options.authMode !== undefined) {
            if (options.authMode === 'https-token' && options.tokenEnvVar !== undefined && options.tokenEnvVar !== '') {
                return `https-token (${options.tokenEnvVar})`;
            }
            return options.authMode;
        }
        let url = '';
        try {
            url = settings().repoUrl;
        }
        catch {
            url = options.repoUrl ?? '';
        }
        if (/^(?:ssh|git|sftp):\/\//i.test(url) || /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/.test(url))
            return 'ssh';
        if (/^https?:\/\//i.test(url))
            return 'https';
        if (/^file:\/\//i.test(url) || !/^[a-z][a-z0-9+.-]*:\/\//i.test(url))
            return 'local-path';
        return 'git';
    };
    const testConnection = async (connectionOptions = {}) => {
        const at = new Date().toISOString();
        const authMethod = authMethodLabel();
        let branch;
        try {
            const resolved = settings();
            branch = resolved.branch;
            const result = await options.run.run(['ls-remote', '--heads', resolved.repoUrl, `refs/heads/${resolved.branch}`], { signal: connectionOptions.signal });
            if (result.code !== 0) {
                const error = gitFailure(result);
                logger.warn('repository connection test failed', { code: error.code });
                return { ok: false, at, branch, head: null, message: redactText(error.message), authMethod };
            }
            let head = null;
            for (const line of result.stdout.split(/\r?\n/)) {
                const match = /^([0-9a-fA-F]{40,64})\s+refs\/heads\/(.+)$/.exec(line.trim());
                if (match === null || match[2] !== resolved.branch)
                    continue;
                head = match[1] ?? null;
                break;
            }
            return {
                ok: true,
                at,
                branch,
                head,
                message: head === null
                    ? `已连接仓库，但分支 ${resolved.branch} 尚不存在 / connected, but branch ${resolved.branch} does not exist yet`
                    : `已连接仓库 / connected; ${resolved.branch} @ ${head.slice(0, 8)}`,
                authMethod,
            };
        }
        catch (error) {
            const code = error instanceof SyncError ? error.code : 'internal';
            logger.warn('repository connection test failed', { code });
            return {
                ok: false,
                at,
                branch,
                head: null,
                message: redactText(errorMessage(error)),
                authMethod,
            };
        }
    };
    return {
        prepare,
        prepared: () => preparedOnce,
        readManifest,
        readProfileState,
        readConfigs,
        readDeviceSnapshots,
        readAtCommit,
        write,
        history,
        testConnection,
    };
}
/** Whether a path exists; used by the dry-run change simulation. */
async function pathExists(path) {
    try {
        await lstat(path);
        return true;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return false;
        throw error;
    }
}
