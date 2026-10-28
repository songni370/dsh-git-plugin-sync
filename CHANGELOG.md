# 变更记录 / Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

This file follows the structure of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- 暂无 / Nothing yet.

## [0.1.12] - 2026-10-28

### Changed

- **压缩「仓库配置」的纵向空间**：去掉上一版的「连接 / 认证 / 设备与 Profile」分组标题与分隔线（视觉上显得空），恢复为一个紧凑表单网格；
- 网格间距收至 12×16、字段标签与输入框间距 4px、卡片内元素间距 12px；输入框高度回到宿主标准的 32px；识别结果条与说明更紧凑；
- 仓库地址与 Profile 行仍独占整行，其余字段两列排列；≤560px 自动单列。

### Verified

- `npm run typecheck`、`npm run build`、`npm test`（17 个测试文件 / 218 个测试）通过。

## [0.1.11] - 2026-10-28

### Changed

- **「仓库配置」表单视觉与排版优化**：
  - 按「连接 / 认证 / 设备与 Profile」分三组，组间加细分隔线与小标题；
  - 仓库地址独占一行，分支与备份目录两列对齐；认证方式与 Token 字段成组出现；
  - 输入框/下拉框统一 34px 高、8px 圆角、1px 边框，增加 hover 边框、`:focus` 品牌色边框 + 3px 光晕；
  - 字段间距 16×20px、标签与输入框 6px、卡片内间距加大；窄屏（≤640px）自动单列；
  - 「测试连接 / 保存」按钮与表单分组留出独立间距，连接结果文案保持原样。

### Verified

- `npm run typecheck`、`npm run build`、`npm test`（17 个测试文件 / 218 个测试）通过。

## [0.1.10] - 2026-10-28

### Fixed

- **初始状态不再显示「认证方式」**：地址为空或无法识别时，认证方式选择、Token 环境变量、用户名全部隐藏；只有识别为 HTTPS 地址后才出现「Git 凭据助手 / HTTPS 令牌」选择，SSH 与本地路径继续不显示认证项。空地址时表单其余字段（分支、备份目录、设备名称等）保持不变。

### Verified

- `npm run typecheck`、`npm run build`、`npm test`（17 个测试文件 / 218 个测试）通过；新增空地址与未识别地址不展示认证字段的测试。

## [0.1.9] - 2026-10-28

### Added

- **仓库地址自动识别传输方式**：根据填写的地址自动判断 HTTPS / SSH / 本地路径（含 `file://`、绝对路径、`~/`），并只展示对应的认证字段：
  - HTTPS：认证方式可选「Git 凭据助手 / HTTPS 令牌」；只有选择 HTTPS 令牌时才显示「令牌环境变量」和「用户名」。
  - SSH（`ssh://`、`git@host:path`）：显示「使用系统 SSH Agent / ~/.ssh 密钥，无需 Token」提示，隐藏认证方式选择与 Token 字段。
  - 本地路径：显示「无需认证」提示，隐藏所有认证字段。
  - 未识别形式：保留完整的认证方式选择。
- 编辑仓库地址时自动切换匹配的认证方式（HTTPS 下已选的「HTTPS 令牌」会保留；从 SSH 改为 HTTPS 时回落到凭据助手）。
- 仓库地址下方新增识别结果条（徽标 + 说明），随输入实时更新。

### Verified

- `npm run typecheck`、`npm run build`、`npm test`（17 个测试文件 / 216 个测试）通过；新增传输识别、认证方式推导与各传输下字段显示的测试。

## [0.1.8] - 2026-10-28

### Changed

- **折叠后的「仓库配置」只显示标题与状态**：去掉了 `地址 · 分支 · 认证方式` 摘要行和描述文字，折叠时只有卡片标题、「已配置 / 未配置仓库」状态徽标与展开按钮，更干净。
- **展开/折叠按钮重做**：从无样式的文字链接改为带边框、圆角、悬停背景、`chevron` 图标（展开时旋转 180°）与焦点环的按钮；文案为「编辑配置 / 收起」，保留 `aria-expanded` / `aria-controls`。

### Verified

- `npm run typecheck`、`npm run build`、`npm test`（15 个测试文件 / 204 个测试）通过；渲染测试覆盖折叠时无摘要/描述、按钮文案与展开行为。

## [0.1.7] - 2026-10-28

### Added

- **「仓库配置」卡片可折叠**：已配置仓库的设备打开页面时默认折叠，标题右侧显示「已配置」徽标与 `仓库地址 · 分支 · 认证方式` 摘要；点「展开编辑」修改，点「收起」恢复摘要。未配置（或刚安装）时默认展开完整表单。保存成功后按新的配置状态自动折叠/展开；有未保存修改时仍显示「未保存」徽标。
- 折叠按钮带 `aria-expanded` / `aria-controls`，折叠时表单不渲染，键盘可达。

### Verified

- `npm run typecheck`、`npm run build`、`npm test`（15 个测试文件 / 204 个测试）通过；新增已配置默认折叠/展开与未配置默认展开的渲染测试。

## [0.1.6] - 2026-10-28

### Changed

- 「配置页面展示」开关的**开启态改为绿色**：使用宿主主题的 `state-success-primary`（实测浅色/深色主题均为 `#22c55e`），圆点保持 `bg-base`（浅色白、深色近黑），开关关闭态仍为中间灰轨道。

### Verified

- `npm run typecheck`、`npm run build`、`npm test`（15 个测试文件 / 202 个测试）通过。

## [0.1.5] - 2026-10-28

### Fixed

- **「配置页面展示」开关在浅色主题下几乎看不见**：原关闭态用 `bg-layer-2`（接近白色）打底、白色圆点，放在白色卡片上对比度极低。现在开关颜色改为成对的语义 token，随客户端浅色/深色主题自动适配：
  - 关闭态：轨道 `label-secondary`（两套主题都是中间灰）、圆点 `bg-base`（浅色为白、深色为深色），始终有对比；
  - 开启态：轨道 `brand-primary`、圆点 `bg-base`，亮暗主题都清晰；
  - 增加按钮尺寸（38×22）、悬停光晕与 `focus-visible` 焦点环，键盘可达。

### Verified

- `npm run typecheck`、`npm run build`、`npm test`（15 个测试文件 / 202 个测试）通过。

## [0.1.4] - 2026-10-28

### Changed

- **「在插件页打开」按钮改为「配置页面展示」开关**：位置移到仓库配置卡片上方一行；开关控制「插件」页面是否显示「备份」标签（默认显示，选择保存在浏览器 localStorage，关闭时移除已注册的标签）。不再自动切页/点击标签。
- **明确并收紧备份范围**：只备份用户后装的第三方插件。DSH 内置/官方插件、DSH 加载器内部条目（`cordis:*`）以及本插件自身都不参与备份，也不再出现在可选插件列表中（此前内置插件已在 0.1.2 过滤，本版补上内部条目与自身）。

### Verified

- `npm run typecheck`、`npm run build`、`npm test`（15 个测试文件 / 202 个测试）通过；新增开关持久化/订阅、自身与内部条目不参与同步、设置页开关渲染与写回测试。

## [0.1.3] - 2026-10-28

### Added

- **插件页标签页**：侧边栏「插件」页面在「已安装 / 插件市场 / 发现」之后新增「备份 / Backup」标签，内容与设置页一致（同一套组件）。
- **设置页顶部按钮**：设置 →「插件备份」页面右上角新增「在插件页打开」按钮；点击后切换到「插件」页面并自动选中「备份」标签。
- 标签页通过宿主 `plugins.tab` 槽注册（order = 1，位于宿主的「发现」之后）；设置页按钮优先走布局服务切换主面板，再按当前语言标签精确点击目标标签，失败时静默回退（页面已打开，用户可自行点击）。
- 文档补充名称、功能与安装位置说明。

### Verified

- `npm run typecheck`、`npm run build`、`npm test`（15 个测试文件 / 201 个测试）通过；新增标签页按钮点击与语言切换测试。

## [0.1.2] - 2026-10-28

### Added

- **设置导航图标**：设置页「插件备份」分区不再使用宿主的默认齿轮，改为插件自己绘制的同步图标（16 px CSS mask，跟随明暗主题与文字色）。

### Fixed

- **打开设置页右侧内容变慢**：一次 215 个插件的全量扫描此前会为每个内置插件读取配置和已安装版本，约 1.4 秒。现在内置/官方插件跳过配置提取与版本文件探测（只作为清单列出），全量扫描实测降到 **约 100 毫秒**。
- **首次打开设置页不再触发仓库克隆/拉取**：状态与插件列表在本地工作副本不存在时按「远端未知」渲染，历史页返回空历史；只有「测试连接」或显式操作才会访问网络。
- **并发扫描合并**：状态与插件列表同时请求时共享一次扫描（单飞 + 10 秒缓存），插件管理器变更会立即失效缓存。
- **设置页插件列表不再混入 200+ 内置插件**：列表只显示可同步的第三方插件。
- 设备信息中的 DSH 版本优先从运行中的应用包读取（回退到已安装的 CLI 包）。

### Verified

- `npm run typecheck`、`npm run build`、`npm test`（14 个测试文件 / 196 个测试）通过；新增导航图标、内置插件扫描成本回归测试。

## [0.1.1] - 2026-10-28

### Changed

- **设置页菜单名称**由「DSH 插件 Git 同步」改为「插件备份」（英文界面为 “Plugin Backup”）。插件清单中的显示名称仍是「DSH 插件 Git 同步 / DSH Plugin Git Sync」，`name`、包名与仓库名不变。
- **明确网页端与客户端可用性**：同一套宿主半（扫描、Git、Agent 工具、自动同步）与 Web 客户端半（设置页）在 DSH Desktop 客户端窗口、浏览器打开的 DSH 页面以及无 UI 的 headless 会话中均可用；插件按 Profile 安装，同一备份仓库按 `profiles/<profile>/` 分开保存各 Profile 的清单。
- 文档同步更新菜单名称，并新增「网页端 / 客户端」可用性说明。

### Verified

- `npm run typecheck`、`npm run build`、`npm test`（13 个测试文件 / 191 个测试）通过；客户端渲染测试断言菜单文案为「插件备份」。

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
- **从 Git 安装**：源码仓库提交了 `lib/` 构建产物；在临时目录用 `pnpm add git+ssh://git@github.com:songni370/dsh-git-plugin-sync.git` 实测安装成功（3.2s），安装后 `lib/index.js`、`lib/client.js`、`cordis.patch.yml` 均在位，Node 可正常导入入口并导出 `apply`。

### Notes

- 已知限制（不在本版本范围内）：只同步当前激活 Profile；本地开发插件默认不同步、且即便开启也只能记录、**无法在其它设备自动恢复**（`archive` 字段与 `backup-tarball:` 规格已预留，归档创建尚未实现）；插件删除默认禁止（`allowPluginRemoval: false`）；构建脚本需用户在插件管理器批准；恢复/同步受宿主插件管理器能力约束；设置页依赖 Web/Desktop Profile；快照不能重装插件，也没有手动快照回滚入口。
- 详细信息见 [README.md](README.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、[docs/SECURITY.md](docs/SECURITY.md)。

[Unreleased]: https://github.com/songni370/dsh-git-plugin-sync/compare/v0.1.12...HEAD
[0.1.12]: https://github.com/songni370/dsh-git-plugin-sync/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/songni370/dsh-git-plugin-sync/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/songni370/dsh-git-plugin-sync/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/songni370/dsh-git-plugin-sync/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/songni370/dsh-git-plugin-sync/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/songni370/dsh-git-plugin-sync/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/songni370/dsh-git-plugin-sync/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/songni370/dsh-git-plugin-sync/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/songni370/dsh-git-plugin-sync/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/songni370/dsh-git-plugin-sync/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/songni370/dsh-git-plugin-sync/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/songni370/dsh-git-plugin-sync/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/songni370/dsh-git-plugin-sync/releases/tag/v0.1.0
