/**
 * Project identity and on-disk layout constants.
 *
 * The names here are the single source shared by the README, the settings page,
 * log lines and error messages: the package name, the two display names, the
 * manifest schema version, and where this plugin keeps its own files.
 * @module constants
 */

/** npm package name and GitHub repository name. */
export const PACKAGE_NAME = 'dsh-plugins-git-sync'

/** Chinese display name used in the DSH settings page and plugin inventory. */
export const TITLE_ZH = 'DSH 插件 Git 同步'

/** English display name used in the DSH settings page and plugin inventory. */
export const TITLE_EN = 'DSH Plugin Git Sync'

/** Version of the backup manifest written into the user's Git repository. */
export const MANIFEST_SCHEMA_VERSION = 1

/** Version of the local state document. */
export const STATE_SCHEMA_VERSION = 1

/** Directory under the DSH home that holds this plugin's state, work tree and logs. */
export const APP_DIR_NAME = 'dsh-plugins-git-sync'

/** Previous data-directory name, read as a fallback so an upgrade keeps config. */
export const LEGACY_APP_DIR_NAME = 'dsh-git-plugin-sync'

/** File names inside {@link APP_DIR_NAME}. */
export const CONFIG_FILE = 'config.json'
export const STATE_FILE = 'state.json'
export const LOG_FILE = 'sync.log'
export const SNAPSHOT_DIR = 'snapshots'
export const WORKDIR_DIR = 'work'
export const ARCHIVE_DIR = 'archives'

/** File names written into the backup repository. */
export const REPO_MANIFEST_FILE = 'manifest.json'
export const REPO_SCHEMA_FILE = 'metadata/schema.json'
export const REPO_README_FILE = 'README.md'
export const REPO_PROFILES_DIR = 'profiles'
export const REPO_PLUGINS_FILE = 'plugins.json'
export const REPO_CONFIGS_DIR = 'configs'
export const REPO_DEVICES_DIR = 'devices'

/** Install source kinds understood by the plugin manager. */
export const NPM_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

/** Maximum bytes of a single config value written into a backup (safety cap). */
export const MAX_CONFIG_BYTES = 64 * 1024

/** Maximum number of files a single backup may write (safety cap). */
export const MAX_BACKUP_FILES = 2_000

/** Git command timeout. */
export const DEFAULT_GIT_TIMEOUT_MS = 120_000

/** How many history entries the history view returns by default. */
export const HISTORY_LIMIT = 100

/** Log ring size kept in memory for the UI. */
export const LOG_RING_SIZE = 500
