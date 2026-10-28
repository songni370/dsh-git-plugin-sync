/**
 * Copy for the settings page, in both languages the Host serves.
 *
 * The dictionaries are registered into the Host locale service under
 * {@link NS}; the page renders through the translator bound to that namespace,
 * so an unpicked key falls back to the key itself and a locale switch
 * re-renders the nav label and every string live.
 *
 * Keys are flat on purpose: the Host's `bind()` returns one flat lookup for a
 * namespace, and a flat table keeps zh/en diff-able line by line.
 * @module i18n
 */

/** Locale namespace owned by this plugin (equals the package name). */
export const NS = 'dsh-git-plugin-sync'

/** Translator signature: key plus optional `{placeholder}` values. */
export type Translate = (key: string, vars?: Record<string, string | number>) => string

/** Placeholder values accepted by {@link Translate}. */
export type Vars = Record<string, string | number>

/** Chinese dictionary (source of truth for the key set). */
export const zh: Record<string, string> = {
  nav: '插件备份',

  intro: '通过 Git 仓库备份、恢复并跨设备同步 DSH 插件与配置。',
  loading: '加载中…',
  retry: '重试',
  refresh: '刷新',
  cancel: '取消',
  close: '关闭',
  save: '保存',
  saving: '保存中…',
  never: '从未',
  unknown: '未知',
  notAvailable: '—',
  noChanges: '没有需要更改的内容。',

  // Sync state badges.
  stateNotConfigured: '未配置',
  stateSynced: '已同步',
  stateAhead: '有待上传变更',
  stateBehind: '有待下载变更',
  stateDiverged: '双向存在差异',
  stateConflict: '存在冲突',
  stateError: '同步失败',
  stateSyncing: '同步中',
  stateUnknown: '未知',

  // Status area.
  statusTitle: '同步状态',
  statusDesc: '当前设备与仓库之间的同步情况。',
  statusDevice: '设备',
  statusBranch: '分支',
  statusLastSync: '上次同步',
  statusLastCommit: '最新提交',
  statusLocalPlugins: '本地插件',
  statusRemotePlugins: '仓库插件',
  statusPendingUp: '待上传',
  statusPendingDown: '待下载',
  statusConflicts: '冲突',
  statusLastError: '最近错误',
  statusLastOperation: '最近操作',
  statusConnection: '连接',
  statusConnectionOk: '可访问',
  statusConnectionFail: '不可访问',
  statusConnectionAt: '检查于 {time}',
  statusBusy: '操作进行中…',
  statusNotConfiguredHint: '尚未配置 Git 仓库。填写下方的仓库地址并保存后，即可开始备份与同步。',
  statusLoadFailed: '加载同步状态失败：{message}',
  sectionCrash: '设置页面渲染失败，请重新打开设置；详细信息见控制台。',

  // Repository configuration.
  configTitle: '仓库配置',
  configDesc: 'Git 仓库地址与认证方式。令牌只保存在环境变量中，本页面不读取也不显示令牌内容。',
  configRepoUrl: '仓库地址',
  configRepoUrlHint: '支持 https、ssh、scp 形式或 file:// 路径。',
  configBranch: '分支',
  configBackupDir: '备份目录',
  configBackupDirHint: '仓库内保存备份数据的子目录；留空表示仓库根目录。',
  configAuthMode: '认证方式',
  configAuthCredentialHelper: 'Git 凭据助手',
  configAuthSsh: 'SSH',
  configAuthHttpsToken: 'HTTPS 令牌',
  configAuthCredentialHelperHint: '使用系统 Git 凭据管理器提供的 HTTPS 凭据。',
  configAuthSshHint: '使用系统 Git 已配置的 SSH 密钥。',
  configAuthHttpsTokenHint: '从环境变量读取访问令牌，通过 HTTPS 推送与拉取。',
  configTokenEnvVar: '令牌环境变量',
  configTokenEnvVarHint: '保存访问令牌的环境变量名，例如 GITHUB_TOKEN。',
  configTokenAvailable: '令牌可用',
  configTokenUnavailable: '令牌不可用',
  configTokenCheckAfterSave: '保存后检测',
  configUsername: '用户名',
  configUsernameHint: 'HTTPS 用户名；留空则使用服务商的默认值。',
  configDeviceName: '设备名称',
  configDeviceNameHint: '在同步状态与历史记录中显示的名称。',
  configTest: '测试连接',
  configTesting: '测试中…',
  configSaved: '配置已保存。',
  configConnectionOk: '连接成功：{message}',
  configConnectionFail: '连接失败：{message}',
  configConnectionMeta: '分支 {branch}；最新提交 {head}；认证方式 {auth}',
  configUnsaved: '有未保存的修改',
  configProfiles: 'DSH Profile',
  configProfilesHint: 'v1 仅同步当前活动的 Profile，其余 Profile 暂不支持。',
  profileActive: '当前',
  profileUnsupported: '暂不支持',

  // Operations.
  actionsTitle: '操作',
  actionsDesc: '手动触发备份、恢复或同步。恢复、同步与历史恢复会先列出将被删除或覆盖的内容。',
  actionBackup: '备份到 Git',
  actionRestore: '从 Git 恢复',
  actionSync: '立即同步',
  actionDiff: '检查差异',
  actionBackupHint: '把本机插件与配置提交并推送到仓库。',
  actionRestoreHint: '用仓库内容覆盖本机插件与配置。',
  actionSyncHint: '双向同步：上传本机变更并下载仓库变更。',
  actionDiffHint: '只预览差异，不修改任何内容。',
  actionBackupDone: '备份完成。',
  actionRestoreDone: '恢复完成。',
  actionSyncDone: '同步完成。',
  actionRollbackDone: '历史恢复完成。',
  actionCommit: '提交 {commit}',
  actionPushed: '已推送',
  actionOutcome: '{ok}/{total} 个步骤成功',
  actionWarnings: '{count} 条警告',
  actionRunning: '正在执行：{action}',
  actionFailed: '操作失败：{message}',
  diffTitle: '差异预览',
  diffDesc: '仅预览，不会修改任何内容。',
  diffDirection: '差异预览方向',
  diffDirectionPush: '备份（上传）',
  diffDirectionPull: '恢复（下载）',
  diffDirectionTwoWay: '双向',
  diffLoadFailed: '加载差异失败：{message}',
  restorePreviewFailed: '加载恢复预览失败：{message}',
  syncPreviewFailed: '加载同步预览失败：{message}',
  rollbackPreviewFailed: '加载历史恢复预览失败：{message}',

  // Plan / confirmation.
  planKindInstall: '安装',
  planKindUpgrade: '升级',
  planKindDowngrade: '降级',
  planKindEnable: '启用',
  planKindDisable: '停用',
  planKindRestoreConfig: '恢复配置',
  planKindRemoveLocal: '移除本机插件',
  planKindPushPlugin: '推送插件',
  planKindPushConfig: '推送配置',
  planKindRemoveRemote: '从仓库移除',
  planDestructive: '破坏性',
  planActionsHeader: '将执行的步骤（{count}）',
  planDestructiveHeader: '将被删除或覆盖（{count}）',
  planWarningsHeader: '警告（{count}）',
  planConflictsHeader: '冲突（{count}）',
  planConflictNote: '这些冲突需要手动处理，自动操作可能因此失败。',
  planEmpty: '没有需要执行的步骤。',
  planSnapshot: '执行前会创建本机快照。',
  planSource: '来源提交：{commit}',
  confirmRestoreTitle: '确认从 Git 恢复',
  confirmSyncTitle: '确认立即同步',
  confirmRollbackTitle: '确认恢复到提交 {commit}',
  confirmRestoreDesc: '仓库中的插件与配置将覆盖本机；下列破坏性步骤会删除或覆盖本机内容。',
  confirmBackupTitle: '确认备份到 Git',
  confirmBackupDesc: '下列破坏性步骤会从仓库移除内容；确认后会把本机状态提交并推送。',
  conflictChoiceLabel: '冲突处理方式',
  conflictChoiceLocal: '保留本机',
  conflictChoiceRemote: '使用仓库',
  conflictChoiceSkip: '跳过',
  confirmSyncDesc: '同步会同时上传本机变更并下载仓库变更；下列破坏性步骤会删除或覆盖内容。',
  confirmRollbackDesc: '本机将恢复到所选提交的状态；下列破坏性步骤会删除或覆盖本机内容。',
  confirmRun: '确认执行',
  confirmRunning: '执行中…',

  // Plugin list.
  pluginsTitle: '插件列表',
  pluginsDesc: '本机与仓库中的插件及其同步状态。取消勾选会把该插件加入排除列表，之后不再同步。',
  pluginsCount: '共 {count} 个插件',
  pluginsEmpty: '本机与仓库中都没有插件。',
  pluginsNoMatch: '没有匹配的插件。',
  pluginsName: '插件',
  pluginsLocalVersion: '本机版本',
  pluginsRemoteVersion: '仓库版本',
  pluginsStatus: '状态',
  pluginsSyncable: '同步',
  pluginsNotSyncable: '内置或不可同步',
  pluginsFilterPlaceholder: '按名称或 ID 筛选',
  pluginsRefresh: '刷新列表',
  pluginsLoadFailed: '加载插件列表失败：{message}',
  pluginsExclusionSaved: '排除列表已保存。',
  pluginsExclusionFailed: '更新排除列表失败：{message}',
  statusSynced: '已同步',
  statusLocalOnly: '仅本机',
  statusRemoteOnly: '仅仓库',
  statusVersionDiff: '版本不同',
  statusConfigDiff: '配置不同',
  statusEnabledDiff: '启用状态不同',
  statusConflict: '冲突',
  statusExcluded: '已排除',

  // Auto sync.
  autoTitle: '自动同步',
  autoDesc: '按设定的条件在后台检查并同步仓库。',
  autoEnabled: '启用自动同步',
  autoEnabledHint: '总开关；关闭后不会自动执行任何操作。',
  autoInterval: '定时同步间隔（分钟）',
  autoIntervalHint: '0 表示不按定时器自动同步。',
  autoStartup: '启动时检查',
  autoStartupHint: 'DSH 启动后检查一次仓库是否有更新。',
  autoPluginChange: '插件变更后同步',
  autoPluginChangeHint: '插件发生变化后延迟触发同步，避免频繁操作。',
  autoModeHint: '自动同步会在后台按上方条件检查并同步；任何自动操作都不会删除未经确认的内容。',
  autoMode: '自动同步行为',
  autoModeTwoWay: '双向同步',
  autoModeBackup: '仅备份',
  autoModeRestore: '仅恢复',
  autoModeBehaviorHint: '自动运行遇到冲突或破坏性操作时会暂停并等待手动处理，不会弹出确认框。',
  autoDebounce: '变更触发延迟：{ms} 毫秒',
  autoSave: '保存自动同步',
  autoSaved: '自动同步设置已保存。',

  // History.
  historyTitle: '历史记录',
  historyDesc: '仓库中的提交记录；可以把本机恢复到任意一次历史提交。',
  historyEmpty: '还没有历史记录。完成一次备份后会显示在这里。',
  historyLoadFailed: '加载历史记录失败：{message}',
  historyColCommit: '提交',
  historyColTime: '时间',
  historyColOperation: '操作',
  historyColDevice: '设备',
  historyColResult: '结果',
  historyColPlugins: '插件数',
  historyRestore: '恢复',
  historyRestoreAria: '恢复到提交 {commit}',
  historyLastOperation: '最近操作',
  historyCount: '最近 {count} 条提交',
  op_backup: '备份',
  op_restore: '恢复',
  op_sync: '同步',
  op_rollback: '历史恢复',
  resultOk: '成功',
  resultFailed: '失败',
}

/** English dictionary; every {@link zh} key must appear here. */
export const en: Record<string, string> = {
  nav: 'Plugin Backup',

  intro: 'Back up, restore, and synchronize DSH plugins and configurations across devices through a Git repository.',
  loading: 'Loading…',
  retry: 'Retry',
  refresh: 'Refresh',
  cancel: 'Cancel',
  close: 'Close',
  save: 'Save',
  saving: 'Saving…',
  never: 'Never',
  unknown: 'Unknown',
  notAvailable: '—',
  noChanges: 'Nothing to change.',

  stateNotConfigured: 'Not configured',
  stateSynced: 'Up to date',
  stateAhead: 'Changes to upload',
  stateBehind: 'Changes to download',
  stateDiverged: 'Changes on both sides',
  stateConflict: 'Conflicts',
  stateError: 'Sync failed',
  stateSyncing: 'Syncing',
  stateUnknown: 'Unknown',

  statusTitle: 'Sync status',
  statusDesc: 'How this device compares with the repository.',
  statusDevice: 'Device',
  statusBranch: 'Branch',
  statusLastSync: 'Last sync',
  statusLastCommit: 'Latest commit',
  statusLocalPlugins: 'Local plugins',
  statusRemotePlugins: 'Repository plugins',
  statusPendingUp: 'To upload',
  statusPendingDown: 'To download',
  statusConflicts: 'Conflicts',
  statusLastError: 'Last error',
  statusLastOperation: 'Last operation',
  statusConnection: 'Connection',
  statusConnectionOk: 'Reachable',
  statusConnectionFail: 'Unreachable',
  statusConnectionAt: 'Checked {time}',
  statusBusy: 'An operation is running…',
  statusNotConfiguredHint: 'No Git repository is configured yet. Enter a repository URL below and save it to start backing up and syncing.',
  statusLoadFailed: 'Could not load sync status: {message}',
  sectionCrash: 'The settings page failed to render. Reopen settings; details are in the console.',

  configTitle: 'Repository',
  configDesc: 'Repository URL and authentication. The token stays in an environment variable; this page neither reads nor displays it.',
  configRepoUrl: 'Repository URL',
  configRepoUrlHint: 'Accepts https, ssh, scp-style, or a file:// path.',
  configBranch: 'Branch',
  configBackupDir: 'Backup directory',
  configBackupDirHint: 'Subdirectory inside the repository that holds the backup; leave empty for the repository root.',
  configAuthMode: 'Authentication',
  configAuthCredentialHelper: 'Git credential helper',
  configAuthSsh: 'SSH',
  configAuthHttpsToken: 'HTTPS token',
  configAuthCredentialHelperHint: 'Use the HTTPS credentials supplied by the system Git credential manager.',
  configAuthSshHint: 'Use an SSH key already configured for system Git.',
  configAuthHttpsTokenHint: 'Read an access token from an environment variable and use it over HTTPS.',
  configTokenEnvVar: 'Token environment variable',
  configTokenEnvVarHint: 'Name of the environment variable holding the token, for example GITHUB_TOKEN.',
  configTokenAvailable: 'Token available',
  configTokenUnavailable: 'Token unavailable',
  configTokenCheckAfterSave: 'Checked after save',
  configUsername: 'Username',
  configUsernameHint: 'HTTPS username; leave empty to use the provider default.',
  configDeviceName: 'Device name',
  configDeviceNameHint: 'Shown in sync status and history.',
  configTest: 'Test connection',
  configTesting: 'Testing…',
  configSaved: 'Configuration saved.',
  configConnectionOk: 'Connection succeeded: {message}',
  configConnectionFail: 'Connection failed: {message}',
  configConnectionMeta: 'Branch {branch}; latest commit {head}; auth {auth}',
  configUnsaved: 'Unsaved changes',
  configProfiles: 'DSH profiles',
  configProfilesHint: 'v1 syncs the active profile only; other profiles are not supported yet.',
  profileActive: 'Active',
  profileUnsupported: 'Not supported yet',

  actionsTitle: 'Operations',
  actionsDesc: 'Back up, restore, or sync manually. Restore, sync, and history restore list what will be removed or overwritten first.',
  actionBackup: 'Back up to Git',
  actionRestore: 'Restore from Git',
  actionSync: 'Sync now',
  actionDiff: 'Check differences',
  actionBackupHint: 'Commit this device’s plugins and configuration and push them.',
  actionRestoreHint: 'Overwrite this device’s plugins and configuration from the repository.',
  actionSyncHint: 'Two-way sync: upload local changes and download repository changes.',
  actionDiffHint: 'Preview only; nothing is modified.',
  actionBackupDone: 'Backup complete.',
  actionRestoreDone: 'Restore complete.',
  actionSyncDone: 'Sync complete.',
  actionRollbackDone: 'Restore from history complete.',
  actionCommit: 'Commit {commit}',
  actionPushed: 'Pushed',
  actionOutcome: '{ok}/{total} steps succeeded',
  actionWarnings: '{count} warnings',
  actionRunning: 'Running: {action}',
  actionFailed: 'Operation failed: {message}',
  diffTitle: 'Differences',
  diffDesc: 'Preview only; nothing is modified.',
  diffDirection: 'Preview direction',
  diffDirectionPush: 'Backup (upload)',
  diffDirectionPull: 'Restore (download)',
  diffDirectionTwoWay: 'Two-way',
  diffLoadFailed: 'Could not load differences: {message}',
  restorePreviewFailed: 'Could not load the restore preview: {message}',
  syncPreviewFailed: 'Could not load the sync preview: {message}',
  rollbackPreviewFailed: 'Could not load the history restore preview: {message}',

  planKindInstall: 'Install',
  planKindUpgrade: 'Upgrade',
  planKindDowngrade: 'Downgrade',
  planKindEnable: 'Enable',
  planKindDisable: 'Disable',
  planKindRestoreConfig: 'Restore config',
  planKindRemoveLocal: 'Remove local plugin',
  planKindPushPlugin: 'Push plugin',
  planKindPushConfig: 'Push config',
  planKindRemoveRemote: 'Remove from repository',
  planDestructive: 'Destructive',
  planActionsHeader: 'Steps to run ({count})',
  planDestructiveHeader: 'Will be removed or overwritten ({count})',
  planWarningsHeader: 'Warnings ({count})',
  planConflictsHeader: 'Conflicts ({count})',
  planConflictNote: 'These conflicts need manual resolution, so the automatic operation may fail.',
  planEmpty: 'No steps to run.',
  planSnapshot: 'A local snapshot is created first.',
  planSource: 'Source commit: {commit}',
  confirmRestoreTitle: 'Confirm restore from Git',
  confirmSyncTitle: 'Confirm sync now',
  confirmRollbackTitle: 'Confirm restore to commit {commit}',
  confirmRestoreDesc: 'Plugins and configuration from the repository will overwrite this device; the destructive steps below remove or overwrite local content.',
  confirmBackupTitle: 'Confirm backup to Git',
  confirmBackupDesc: 'The destructive steps below remove content from the repository; confirming commits and pushes this device’s state.',
  conflictChoiceLabel: 'Conflict resolution',
  conflictChoiceLocal: 'Keep local',
  conflictChoiceRemote: 'Use repository',
  conflictChoiceSkip: 'Skip',
  confirmSyncDesc: 'Sync uploads local changes and downloads repository changes; the destructive steps below remove or overwrite content.',
  confirmRollbackDesc: 'This device returns to the selected commit; the destructive steps below remove or overwrite local content.',
  confirmRun: 'Run',
  confirmRunning: 'Running…',

  pluginsTitle: 'Plugins',
  pluginsDesc: 'Plugins on this device and in the repository with their sync state. Clearing a checkbox adds the plugin to the exclusion list so it is never synced.',
  pluginsCount: '{count} plugins',
  pluginsEmpty: 'No plugins exist locally or in the repository.',
  pluginsNoMatch: 'No plugins match the filter.',
  pluginsName: 'Plugin',
  pluginsLocalVersion: 'Local version',
  pluginsRemoteVersion: 'Repository version',
  pluginsStatus: 'Status',
  pluginsSyncable: 'Sync',
  pluginsNotSyncable: 'Built-in or not syncable',
  pluginsFilterPlaceholder: 'Filter by name or ID',
  pluginsRefresh: 'Refresh list',
  pluginsLoadFailed: 'Could not load the plugin list: {message}',
  pluginsExclusionSaved: 'Exclusion list saved.',
  pluginsExclusionFailed: 'Could not update the exclusion list: {message}',
  statusSynced: 'Synced',
  statusLocalOnly: 'Local only',
  statusRemoteOnly: 'Repository only',
  statusVersionDiff: 'Version differs',
  statusConfigDiff: 'Config differs',
  statusEnabledDiff: 'Enabled state differs',
  statusConflict: 'Conflict',
  statusExcluded: 'Excluded',

  autoTitle: 'Automatic sync',
  autoDesc: 'Check and sync the repository in the background under the conditions below.',
  autoEnabled: 'Enable automatic sync',
  autoEnabledHint: 'Master switch; nothing runs automatically while it is off.',
  autoInterval: 'Interval (minutes)',
  autoIntervalHint: '0 disables timer-based sync.',
  autoStartup: 'Check on startup',
  autoStartupHint: 'Check the repository once after DSH starts.',
  autoPluginChange: 'Sync after plugin changes',
  autoPluginChangeHint: 'Trigger a delayed sync after plugins change, to avoid frequent operations.',
  autoModeHint: 'Automatic sync checks and syncs in the background under the conditions above; it never removes content without confirmation.',
  autoMode: 'Automatic behavior',
  autoModeTwoWay: 'Two-way sync',
  autoModeBackup: 'Backup only',
  autoModeRestore: 'Restore only',
  autoModeBehaviorHint: 'An automatic run pauses on conflicts or destructive plans and waits for manual action instead of prompting.',
  autoDebounce: 'Change trigger delay: {ms} ms',
  autoSave: 'Save automatic sync',
  autoSaved: 'Automatic sync settings saved.',

  historyTitle: 'History',
  historyDesc: 'Commits in the repository; this device can be restored to any of them.',
  historyEmpty: 'No history yet. It appears after the first backup.',
  historyLoadFailed: 'Could not load history: {message}',
  historyColCommit: 'Commit',
  historyColTime: 'Time',
  historyColOperation: 'Operation',
  historyColDevice: 'Device',
  historyColResult: 'Result',
  historyColPlugins: 'Plugins',
  historyRestore: 'Restore',
  historyRestoreAria: 'Restore to commit {commit}',
  historyLastOperation: 'Last operation',
  historyCount: '{count} recent commits',
  op_backup: 'Backup',
  op_restore: 'Restore',
  op_sync: 'Sync',
  op_rollback: 'History restore',
  resultOk: 'Succeeded',
  resultFailed: 'Failed',
}

/** Replace `{name}` placeholders in one dictionary string. */
export function interpolate(template: string, vars?: Vars): string {
  if (vars === undefined) return template
  let text = template
  for (const [name, value] of Object.entries(vars)) {
    text = text.split(`{${name}}`).join(String(value))
  }
  return text
}

/**
 * Adapt the Host-bound translator.
 *
 * The Host already interpolates `{name}` placeholders; running the result
 * through {@link interpolate} again is a no-op when it did, and makes the page
 * correct on a Host whose translator returns the template untouched.
 */
export function createTranslate(bound: (key: string, vars?: Vars) => string): Translate {
  return (key, vars) => {
    let text: string
    try {
      const translated = bound(key, vars)
      text = typeof translated === 'string' && translated !== '' ? translated : key
    } catch {
      // A translator that throws must cost one string, not the whole page.
      text = (navigatorLanguage().startsWith('zh') ? zh[key] : en[key]) ?? key
    }
    return interpolate(text, vars)
  }
}

/** Browser language, or `en` where `navigator` is absent. */
function navigatorLanguage(): string {
  try {
    return typeof navigator === 'undefined' ? 'en' : navigator.language.toLowerCase()
  } catch {
    return 'en'
  }
}

/**
 * Standalone translator used only when the Host locale service cannot bind
 * (a host whose locale contract moved). The page still reads — the browser
 * language picks the dictionary — instead of rendering bare keys.
 */
export function fallbackTranslate(): Translate {
  const dict = navigatorLanguage().startsWith('zh') ? zh : en
  return (key, vars) => interpolate(dict[key] ?? key, vars)
}
