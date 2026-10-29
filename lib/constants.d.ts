/**
 * Project identity and on-disk layout constants.
 *
 * The names here are the single source shared by the README, the settings page,
 * log lines and error messages: the package name, the two display names, the
 * manifest schema version, and where this plugin keeps its own files.
 * @module constants
 */
/** npm package name and GitHub repository name. */
export declare const PACKAGE_NAME = "dsh-plugins-git-sync";
/** Chinese display name used in the DSH settings page and plugin inventory. */
export declare const TITLE_ZH = "\u63D2\u4EF6\u5907\u4EFD";
/** English display name used in the DSH settings page and plugin inventory. */
export declare const TITLE_EN = "Plugin Backup";
/** Version of the backup manifest written into the user's Git repository. */
export declare const MANIFEST_SCHEMA_VERSION = 1;
/** Version of the local state document. */
export declare const STATE_SCHEMA_VERSION = 1;
/** Directory under the DSH home that holds this plugin's state, work tree and logs. */
export declare const APP_DIR_NAME = "dsh-plugins-git-sync";
/** Previous data-directory name, read as a fallback so an upgrade keeps config. */
export declare const LEGACY_APP_DIR_NAME = "dsh-git-plugin-sync";
/** File names inside {@link APP_DIR_NAME}. */
export declare const CONFIG_FILE = "config.json";
export declare const STATE_FILE = "state.json";
export declare const LOG_FILE = "sync.log";
export declare const SNAPSHOT_DIR = "snapshots";
export declare const WORKDIR_DIR = "work";
export declare const ARCHIVE_DIR = "archives";
/** File names written into the backup repository. */
export declare const REPO_MANIFEST_FILE = "manifest.json";
export declare const REPO_SCHEMA_FILE = "metadata/schema.json";
export declare const REPO_README_FILE = "README.md";
export declare const REPO_PROFILES_DIR = "profiles";
export declare const REPO_PLUGINS_FILE = "plugins.json";
export declare const REPO_CONFIGS_DIR = "configs";
export declare const REPO_DEVICES_DIR = "devices";
/** Install source kinds understood by the plugin manager. */
export declare const NPM_NAME_PATTERN: RegExp;
/** Maximum bytes of a single config value written into a backup (safety cap). */
export declare const MAX_CONFIG_BYTES: number;
/** Maximum number of files a single backup may write (safety cap). */
export declare const MAX_BACKUP_FILES = 2000;
/** Git command timeout. */
export declare const DEFAULT_GIT_TIMEOUT_MS = 120000;
/** How many history entries the history view returns by default. */
export declare const HISTORY_LIMIT = 100;
/** Log ring size kept in memory for the UI. */
export declare const LOG_RING_SIZE = 500;
