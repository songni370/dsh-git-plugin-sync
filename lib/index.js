/**
 * Host entry of **DSH 插件 Git 同步 / DSH Plugin Git Sync**.
 *
 * Wires the platform pieces together and keeps itself inert when an optional
 * Host service is missing: the plugin never throws during profile boot, because
 * a thrown plugin load can take the whole DSH profile down.
 *
 * No runtime dependency on any `@deepseek-ai/*` package is used: services are
 * reached through `ctx.get()` / `ctx.inject()` and the browser half through the
 * Harness module table. This keeps the published plugin installable on a
 * Harness whose internals moved.
 * @module index
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DIR_NAME, PACKAGE_NAME, TITLE_EN, TITLE_ZH, } from './constants.js';
import { createLogger } from './core/logger.js';
import { errorMessage } from './core/errors.js';
import { createInstaller } from './adapters/installer.js';
import { createConfigGateway } from './scanner/config-gateway.js';
import { createScanner } from './scanner/inventory.js';
import { listProfiles } from './scanner/profiles.js';
import { createGitRunner } from './git/git-runner.js';
import { createRepoStore } from './git/repo-store.js';
import { createEngine } from './services/engine.js';
import { createScheduler } from './services/scheduler.js';
import { registerHttpRoutes } from './http/routes.js';
import { registerTools } from './tools/tools.js';
import { ConfigStore, StateStore, createDeviceInfo, defaultDeviceName, defaultState, ensurePrivateDir, normalizeConfig, resolveStorePaths, } from './state/store.js';
import { displayPath } from './core/paths.js';
/** Cordis plugin name; equals the bundle row id and the npm package name. */
export const name = PACKAGE_NAME;
/** No hard service dependency: every service is feature-detected. */
export const inject = [];
/** Resolve the DSH home from the environment or the running profile. */
function resolveDshHome(profileContext) {
    const configured = (process.env.DSH_HOME ?? '').trim();
    if (configured !== '')
        return configured;
    const profileDir = (profileContext?.dir ?? '').trim();
    if (profileDir !== '') {
        // <home>/profiles/<name> → <home>
        return dirname(dirname(profileDir));
    }
    return join(homedir(), '.dsh');
}
/** Resolve the active profile name. */
function resolveProfileName(profileContext) {
    const fromContext = (profileContext?.name ?? '').trim();
    if (fromContext !== '')
        return fromContext;
    const fromEnv = (process.env.DSH_PROFILE ?? '').trim();
    if (fromEnv !== '')
        return fromEnv;
    const dir = (profileContext?.dir ?? '').trim();
    if (dir !== '')
        return basename(dir);
    return 'desktop';
}
/** Read this plugin's own version from its package manifest. */
async function readPluginVersion() {
    try {
        const manifestUrl = new URL('../package.json', import.meta.url);
        const text = await readFile(fileURLToPath(manifestUrl), 'utf8');
        const parsed = JSON.parse(text);
        return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/**
 * Read the running DSH version.
 *
 * The desktop application and the `dsh` CLI package under the profile are
 * separate installs and can disagree (a profile may still hold an older CLI
 * package), so the running application bundle is asked first. Electron's
 * patched filesystem reads inside `app.asar`; a non-Electron host simply fails
 * that candidate and falls back to the installed CLI package.
 */
async function readDshVersion(dshHome, profile) {
    const electron = process;
    const resources = typeof electron.resourcesPath === 'string' ? electron.resourcesPath : '';
    // The desktop host starts as `…/Resources/app.asar/dsh/…`; derive the bundle
    // from argv for hosts where process.resourcesPath is not set.
    const asarIndex = process.argv.find(arg => arg.includes('app.asar'));
    const asarRoot = asarIndex === undefined ? '' : join(asarIndex.slice(0, asarIndex.indexOf('app.asar')), 'app.asar');
    const candidates = [
        // The running application bundle is the authority; its package is the
        // desktop shell (@deepseek-ai/dsh-desktop), not the CLI package.
        ...(resources === '' ? [] : [{ path: join(resources, 'app.asar', 'package.json'), anyPackage: true }]),
        ...(asarRoot === '' ? [] : [{ path: join(asarRoot, 'package.json'), anyPackage: true }]),
        { path: join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), anyPackage: false },
        { path: join(dshHome, 'profiles', profile, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), anyPackage: false },
        { path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package.json'), anyPackage: false },
    ];
    for (const candidate of candidates) {
        try {
            const text = await readFile(candidate.path, 'utf8');
            const parsed = JSON.parse(text);
            if (typeof parsed.version !== 'string')
                continue;
            if (candidate.anyPackage || parsed.name === '@deepseek-ai/dsh')
                return parsed.version;
        }
        catch {
            continue;
        }
    }
    return 'unknown';
}
/** Default HTTPS username for well-known providers. */
function defaultGitUsername(repoUrl) {
    const lower = repoUrl.toLowerCase();
    if (lower.includes('github.com'))
        return 'x-access-token';
    if (lower.includes('gitlab'))
        return 'oauth2';
    if (lower.includes('gitea'))
        return 'x-access-token';
    return 'git';
}
/** Plugin entry point. */
export function apply(ctx) {
    let running = null;
    let disposed = false;
    const disposers = [];
    const start = async () => {
        const profileContext = ctx.get('profileContext');
        const dshHome = resolveDshHome(profileContext);
        const activeProfile = resolveProfileName(profileContext);
        const profilesRoot = join(dshHome, 'profiles');
        const paths = resolveStorePaths(dshHome);
        const pluginVersion = await readPluginVersion();
        const dshVersion = await readDshVersion(dshHome, activeProfile);
        const logger = createLogger({
            filePath: paths.logPath,
            host: ctx.logger,
            ringSize: 500,
        });
        await ensurePrivateDir(paths.dataDir);
        await ensurePrivateDir(paths.workDir);
        await ensurePrivateDir(paths.snapshotDir);
        await ensurePrivateDir(paths.archiveDir);
        const profiles = await listProfiles(profilesRoot).catch(() => []);
        const availableProfiles = profiles.length > 0 ? profiles.map(profile => profile.name) : [activeProfile];
        const services = {
            pluginManager: ctx.get('pluginManager'),
            configEditor: ctx.get('configEditor'),
            settings: ctx.get('settings'),
            profileContext,
        };
        const device = createDeviceInfo({
            existing: null,
            name: defaultDeviceName(),
            dshVersion,
            pluginVersion,
        });
        const configStore = new ConfigStore(paths.configPath, input => normalizeConfig(input, activeProfile, availableProfiles));
        const stateStore = new StateStore(paths.statePath, () => defaultState(device));
        const initialConfig = await configStore.read();
        const initialState = await stateStore.read();
        const deviceWithConfig = createDeviceInfo({
            existing: initialState.device,
            name: initialConfig.deviceName,
            dshVersion,
            pluginVersion,
        });
        if (deviceWithConfig.id !== initialState.device.id || deviceWithConfig.name !== initialState.device.name) {
            initialState.device = deviceWithConfig;
            await stateStore.write(initialState);
        }
        const scanner = createScanner({
            services,
            profilesRoot,
            pluginVersion,
            dshVersion,
            logger,
            device: initialState.device,
        });
        const configGateway = createConfigGateway({ services, logger });
        const installer = createInstaller({
            pluginManager: services.pluginManager,
            activeProfile,
            logger,
        });
        const createRepo = (config) => {
            const key = createHash('sha256').update(`${config.repoUrl}\n${config.branch}`).digest('hex').slice(0, 20);
            const workDir = join(paths.workDir, key);
            const tokenProvider = async () => {
                if (config.authMode !== 'https-token' || config.tokenEnvVar === '')
                    return null;
                const token = process.env[config.tokenEnvVar] ?? '';
                if (token.trim() === '')
                    return null;
                return { username: config.username === '' ? defaultGitUsername(config.repoUrl) : config.username, token };
            };
            const run = createGitRunner({ logger, tokenProvider });
            const store = createRepoStore({
                run,
                workDir,
                repoUrl: config.repoUrl,
                branch: config.branch,
                backupDir: config.backupDir,
                logger,
            });
            return { store, workDir };
        };
        let schedulerRef = null;
        const engine = createEngine({
            logger,
            configStore,
            stateStore,
            paths,
            scanner,
            configGateway,
            installer,
            pluginVersion,
            dshVersion,
            activeProfile,
            availableProfiles,
            platform: process.platform,
            env: process.env,
            createRepo,
            onConfigChanged: config => {
                schedulerRef?.applyConfig(config);
            },
        });
        const scheduler = createScheduler({
            ctx,
            engine,
            logger,
            onPaused: reason => logger.warn(`自动同步暂停 / automatic sync paused: ${reason}`),
        });
        schedulerRef = scheduler;
        scheduler.applyConfig(initialConfig);
        running = { scheduler, logger };
        disposers.push(ctx.inject(['tools'], scoped => {
            return registerTools({ ctx: scoped, engine, logger });
        }));
        disposers.push(registerHttpRoutes({ ctx, engine, logger }));
        disposers.push(ctx.on('plugin-manager/changed', (() => {
            // Never throws into the Host: a change notification must not break the
            // operation that produced it.
            try {
                engine.invalidateScan();
                scheduler.notifyPluginChange();
            }
            catch (error) {
                logger.debug(`插件变更通知处理失败 / plugin-change notification failed: ${errorMessage(error)}`);
            }
        })));
        logger.info(`${TITLE_ZH} / ${TITLE_EN} 已加载`, {
            version: pluginVersion,
            dshVersion,
            profile: activeProfile,
            dataDir: displayPath(paths.dataDir),
            profiles: availableProfiles,
            pluginManager: services.pluginManager !== undefined,
        });
        if (disposed)
            stop();
    };
    const stop = () => {
        running?.scheduler.dispose();
        running = null;
        for (const disposer of disposers.splice(0)) {
            try {
                void disposer();
            }
            catch {
                // The owning fiber tears down anyway.
            }
        }
    };
    ctx.effect(() => {
        void start().catch(error => {
            try {
                ctx.logger.error(`[${PACKAGE_NAME}] 加载失败 / failed to load: ${errorMessage(error)}`);
            }
            catch {
                // Nothing left to report to.
            }
        });
        return () => {
            disposed = true;
            stop();
        };
    }, `${PACKAGE_NAME}: lifecycle`);
}
/** Re-exported for tests and for a future service surface. */
export { apply as start, inject as services, name as pluginName, createEngine };
export { APP_DIR_NAME };
