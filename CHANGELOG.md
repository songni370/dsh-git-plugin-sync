# 变更记录 / Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

This file follows the structure of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- 暂无 / Nothing yet.

## [0.1.0] - 2026-10-28

首个公开版本，**在 DSH 0.2.1-rc.3 上实测**（First public release, **verified on DSH 0.2.1-rc.3**）。

### Added

- **插件清单扫描**：以 DSH 插件管理器为主要来源，读取包名、版本、来源类型、可复现安装规格（`installSpec`）、启用状态、bundle 行与经过脱敏过滤的配置；插件管理器不可用时回退读取 Profile `package.json` 依赖。内置/官方插件被列出但不参与同步。
- **Git 仓库备份**：把本机插件状态写成可读 JSON（`manifest.json`、`profiles/<profile>/plugins.json`、`profiles/<profile>/configs/*.json`、`devices/<deviceId>/<profile>.json`、`metadata/schema.json`、仓库 `README.md`），提交并推送；内容无变化时不会产生空提交。
- **恢复**：按仓库清单安装/升级/降级插件、写回配置、恢复启用状态；恢复前自动创建本机快照；**从不删除备份中不存在的本机插件**。
- **双向同步与基线**：base / local / remote 三方比较归属改动，只推送本机改动、只应用远端改动；同步成功后更新基线。
- **冲突处理**：`both-changed`、`local-deleted`、`remote-deleted`、`config-conflict` 四类冲突一律停下来等用户决定；支持 `local` / `remote` / `skip` / `manual` 四种选择（`manual` 通过 HTTP API 与 Agent 工具提供 `manualConfig`）。
- **版本语义**：只同步仓库中记录的版本（可升可降，降级属破坏性操作需确认），不查询最新版本。
- **历史与回滚**：从 Git 提交历史恢复到任意提交；提交携带 `Operation` / `Device-Id` / `Device-Name` / `Profile` / `Result` / `Plugin-Count` trailer，并以此解析历史。
- **自动同步**：默认关闭；支持 `two-way` / `backup` / `restore` 模式、定时间隔、启动后只读检查、插件变更触发；包含防抖、互斥、60 秒冷却、失败退避（60 秒 / 5 分钟 / 15 分钟，最多 3 次）与暂停条件（未配置仓库、未解决冲突、破坏性计划）。
- **Web 设置页**（「Git 同步」分区）：状态（5 秒轮询）、仓库配置、测试连接、备份/恢复/同步/检查差异、插件列表与排除、快照与历史、破坏性操作预览确认对话框；中英文文案随宿主语言切换。
- **6 个 Agent 工具**：`dsh_git_plugin_status`、`dsh_git_plugin_backup`、`dsh_git_plugin_restore`、`dsh_git_plugin_sync`、`dsh_git_plugin_diff`、`dsh_git_plugin_history`；破坏性操作两阶段确认（先预览、`confirm: true` 才执行）。
- **本机持久化**：`$DSH_HOME/dsh-git-plugin-sync/` 下的 `config.json`、`state.json`、`sync.log`、`snapshots/`、`work/`（`archives/` 为预留目录），文件权限 `0600`、目录 `0700`，原子写入。
- **确定性序列化与 schema 版本化**：备份清单 `schemaVersion = 1`；读到更新的 schema 会明确提示升级插件，而不是猜测或静默修复；非法结构报 `invalid-manifest`。
- **零运行时 npm 依赖**：宿主服务通过 `ctx.get()` / `ctx.inject()` 结构式访问；`package.json` 只有 `devDependencies`。
- **文档**：`README.md`（中文）、`README_EN.md`（英文）、`docs/ARCHITECTURE.md`、`docs/SECURITY.md`、`docs/PUBLISHING.md`、`CHANGELOG.md`。
- **测试**：`tests/unit/repo-files.test.ts`（序列化边界的路径清洗）、`tests/unit/tools.test.ts`（6 个工具名、无损 JSON、两阶段确认）、`tests/unit/routes.test.ts`（HTTP 路由与信封）、`tests/unit/scheduler.test.ts`（自动同步调度行为）、`tests/client/render.test.tsx`（设置页 jsdom 渲染冒烟测试）。

### Fixed

首个版本中在开发期修复/收敛的行为（Fixed during initial development）：

- **并发推送不再覆盖其他设备**：非快进推送会重新拉取、重算并重试（默认 3 次），仍失败则以可重试的 `git-push-rejected` 结束，**绝不 force push**。
- **配置写回不再覆盖同一条目的其它配置键**：优先通过 `configEditor.edit()` 在当前配置上合并受同步的键，保留未同步的键。
- **清单读取不再静默修复非法数据**：结构/类型/时间/ID/数量上限/符号链接等校验失败直接报 `invalid-manifest`，不写入、不覆盖。
- **插件管理器数据异常不再导致扫描失败**：单个插件记录解析失败只记录到该条目的 `error` 字段；配置读取失败只产生警告。
- **自动同步不会因插件安装自身触发变更事件而死循环**：变更触发带防抖，两次自动运行之间至少 60 秒冷却。
- **`sync/preview` 的线上格式与契约一致**：现在返回 `{ direction: 'two-way', plan }`，与 `SyncPreviewResponse = DiffResponse` 匹配（之前只返回 `{ plan }`，客户端恰好只读 `plan` 才没出问题）。
- **`manifest.json` / `metadata/schema.json` 的 `generator.version` 不再写死**：`buildManifest({ generatorVersion })` 与 `buildSchemaDocument(pluginVersion)` 由引擎传入运行中的插件版本，升级插件后备份会记录新版本。

### Changed

- **移除死参数**：`SyncOptions.automatic` 已删除（声明了但引擎从未读取），调度器现在直接调用 `engine.sync({ confirmDestructive: false })`；自动同步「遇破坏性计划暂停」的行为仍由 `confirmDestructive: false` 保证。
- **DSH 版本探测更准确**：设备身份优先读取运行中的应用包（`resources/app.asar/package.json`，如 `0.2.1-rc.3`），读不到时回退到 Profile 中安装的 `@deepseek-ai/dsh` 包，仍然读不到则记 `unknown`；不再误取到与运行中应用不同的 CLI 版本。

### Security

- **不上传任何密钥类数据**：按配置键名（`apiKey`、`token`、`secret`、`password`、`authorization`、`cookie`、`privateKey`、`clientSecret` 等）与值形态（PEM 私钥、`sk-…`、`ghp_…`/`github_pat_…`、`glpat-…`、`xox?-…`、`AKIA…`、Bearer、JWT、URL 中的 `user:pass@`）双向过滤；命中的配置键记录在 `configSkipped` 中（只记键名）。
- **不写入机器绝对路径**：`localPath` 只在内存/本机使用，写入仓库前被剥离；本地插件 `source` 只保留相对/可复现形式；仓库 URL 中的用户名/密码在保存时即被拒绝。
- **序列化层强制清洗行内本地路径**：插件行的 `moduleName` / `entryId` 若是绝对 `file:///…` 路径、盘符路径、以 `/` 或反斜杠开头、含反斜杠或控制字符，写入仓库前会被替换为插件包名（或丢弃）。这条规则在 `services/repo-files.ts` 的序列化边界执行（`sanitizeModuleName` / `sanitizeRows` / `sanitizePluginRecord`），设备快照同样清洗；起因是真实环境里有插件（如 cc-safety-net）通过 `file:///…` 引用模块。
- **令牌只经环境变量传递**：配置只保存环境变量名；Git 子进程通过 `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_*` / `GIT_CONFIG_VALUE_*` 注册临时 `credential.helper` 读取令牌，令牌不出现在命令行参数（因而也不出现在 `ps`）或任何 Git 配置文件中。
- **Git 子进程加固**：参数数组 + `shell: false`；`GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`；单条命令默认 120 秒超时并 `SIGKILL`；stdout/stderr 各截断到 1 MiB；拒绝 NUL 字节、以选项开头的子命令、`-c`、`--upload-pack` / `--receive-pack` / `--exec-path` / `--config-env` / `--git-dir` / `--work-tree` 等危险选项。
- **路径与符号链接防护**：备份仓库视为不可信输入——绝对路径、`..`、Windows 盘符、URL scheme、NUL、`.git`/`GIT~1`、符号链接一律拒绝读写；写入前逐段 `lstat` 校验。
- **日志与错误统一脱敏**：日志消息经 `redactText`、详情经 `redactJson` 处理后写 `sync.log` 与宿主日志；Git 错误分类前先脱敏；认证方式在状态里只显示方法名（如 `HTTPS token from $GITHUB_TOKEN`），不含令牌。
- **恢复前快照与尽力回滚**：恢复/同步/历史回滚在改动本机前写快照；执行失败时自动回滚配置与启用状态，并明确报告无法回滚的插件安装。
- **危险操作显式确认**：删除类操作与含破坏性步骤的计划必须 `confirmDestructive: true` / Agent 工具 `confirm: true`；自动同步不代替用户确认，遇破坏性计划即暂停。

### Verified

- **DSH 0.2.1-rc.3**：宿主 API 清单（`pluginManager`、`configEditor`、`settings`、`profileContext`、`connection.fetch.register`、`tools.register`）按该版本核对；本插件在该版本上实测可用。
- 本机验证：`npm run typecheck`、`npm run build`、`node --check lib/client.js` 通过；`npx vitest run` = **13 个测试文件 / 191 个测试通过**（单元 + 双设备集成 + jsdom 渲染冒烟）。**注意**：渲染测试是 jsdom 环境下的页面挂载/交互测试，不等同于真实 Harness 页面的人工 GUI 验证。
- 零运行时依赖、Node `>= 22.19.0`、`git` 需在 `PATH` 中（Git 2.30+ 建议，代码不强制校验版本）。

### Notes

- 已知限制（不在本版本范围内）：只同步当前激活 Profile；本地开发插件默认不同步、且即便开启也只能记录、**无法在其它设备自动恢复**（`archive` 字段与 `backup-tarball:` 规格已预留，归档创建尚未实现）；插件删除默认禁止（`allowPluginRemoval: false`）；构建脚本需用户在插件管理器批准；恢复/同步受宿主插件管理器能力约束；设置页依赖 Web/Desktop Profile；快照不能重装插件，也没有手动快照回滚入口。
- 详细信息见 [README.md](README.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、[docs/SECURITY.md](docs/SECURITY.md)。

[Unreleased]: https://github.com/songni370/dsh-git-plugin-sync/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/songni370/dsh-git-plugin-sync/releases/tag/v0.1.0
