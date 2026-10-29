# 架构说明 / Architecture

本文面向维护者，说明 **DSH 插件 Git 同步（`dsh-plugins-git-sync`）** 的模块边界、数据流、状态文件、双向同步算法、安全不变量与扩展点。用户文档见 [README.md](../README.md)。

This document is for maintainers: module boundaries, data flow, state files, the two-way synchronization algorithm, safety invariants, and extension points. User documentation is in [README_EN.md](../README_EN.md).

---

## 1. 设计目标与不变量

1. **一个业务入口**：设置页、HTTP 路由、Agent 工具都只调用 `SyncEngine`；三者不各自实现操作逻辑。
2. **先规划、后执行**：所有会改变本机或仓库的动作先由纯函数规划器（`services/plan.ts`）产出 `SyncPlan`，UI/工具展示它，执行器只执行计划里的动作。
3. **仓库是不可信输入**：备份仓库可能来自任何地方、由旧版本或新版本插件写入。所有读取都经过 manifest 校验与路径校验；非法数据报 `invalid-manifest` / `invalid-path`，不修复、不猜测。
4. **永不 force push**：非快进推送 → 重新拉取 → 重算（`rebuild`）→ 重试；超过预算就失败，把冲突留给下一次运行。
5. **破坏性操作必须显式确认**：删除本机插件、删除仓库记录、降级都标记 `destructive`，必须 `confirmDestructive`（设置页）/ `confirm: true`（Agent 工具）。
6. **改动本机前先快照**：恢复、同步、历史回滚在执行本机动作之前写本机快照。
7. **秘密不出本机**：配置在进入备份前由脱敏规则过滤；令牌只经环境变量传给 Git 子进程；日志统一脱敏。
8. **确定性**：序列化键排序、固定缩进、结尾换行，因此「内容相同」等价于「字节相同」，从而可靠地判断「无变化 = 不产生提交」。

## 2. 模块地图

```text
                         ┌──────────────────────────────────────────────┐
 Host (Node)             │ src/index.ts  (Cordis plugin entry)          │
                         │  装配: state/store, scanner, installer,      │
                         │        config-gateway, engine, scheduler,    │
                         │        http routes, agent tools              │
                         └───────────────┬──────────────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────────┐
        │                                │                                    │
┌───────▼────────┐              ┌────────▼─────────┐              ┌───────────▼──────────┐
│ services/      │              │ http/routes.ts   │              │ tools/tools.ts       │
│  engine.ts     │◄─────────────┤ 14 个 POST 路由  │              │ 6 个 Agent 工具      │
│  (唯一编排)    │◄─────────────┤ api-types.ts     │              │                      │
└───┬───┬───┬────┘              └──────────────────┘              └──────────────────────┘
    │   │   │
    │   │   └──────────────────────────────► services/scheduler.ts (自动同步)
    │   │
    │   ├──► services/plan.ts      (纯函数: planBackup / planRestore / planSync)
    │   ├──► services/executor.ts  (执行计划中的本机动作)
    │   ├──► services/snapshot.ts  (本机快照 / 尽力回滚)
    │   ├──► services/repo-files.ts(内存状态 ↔ 仓库文件, buildBaseline)
    │   ├──► services/model.ts     (可比较的 PluginState 投影)
    │   ├──► scanner/inventory.ts  (插件清单) ──► scanner/config-gateway.ts / scanner/profiles.ts
    │   ├──► adapters/installer.ts (pluginManager: 安装/启停/移除)
    │   ├──► state/store.ts        (config.json / state.json / 路径解析)
    │   └──► git/repo-store.ts     (唯一的 Git 工作区拥有者)
    │           ├──► git/git-runner.ts   (安全子进程)
    │           ├──► git/repo-paths.ts   (布局 + 路径安全)
    │           └──► manifest/manifest.ts(构建/校验/确定性序列化)
    │
    └──► core/*  (errors, json, logger, mutex, paths, redact, version)
```

| 层 | 模块 | 职责 | 依赖方向 |
| --- | --- | --- | --- |
| 入口 | `index.ts` | 解析 DSH home/profile；解析 DSH 版本（优先运行中的应用包 `resources/app.asar/package.json`，回退 Profile 里安装的 `@deepseek-ai/dsh`，再不行记 `unknown`）；创建 logger、scanner、installer、config gateway、engine、scheduler；注册 HTTP 路由与 Agent 工具；监听 `plugin-manager/changed`；卸载时清理。 | → 所有下层 |
| 编排 | `services/engine.ts` | 唯一业务入口：`status`、`saveConfig`、`testConnection`、`listPlugins`、`diff`、`backup`、`previewRestore`、`restore`、`rollback`、`previewSync`、`sync`、`history`、`setAutoSync`、`logs`、`listSnapshots`、`rollbackSnapshot`。持有互斥、快照、基线更新与状态持久化。 | → plan, executor, snapshot, repo-files, model, scanner, installer, gateway, state, git |
| 规划 | `services/plan.ts` | 纯函数（无 I/O）：三方比较、生成动作与冲突、危险标记、警告。 | → model, core/version |
| 执行 | `services/executor.ts` | 逐条执行本机动作（install/upgrade/downgrade/enable/disable/restore-config/remove-local），单条失败不影响其它。 | → types |
| 调度 | `services/scheduler.ts` | 定时/启动检查/变更触发；互斥、冷却、退避、暂停；定时器随生命周期清理。 | → engine |
| 快照 | `services/snapshot.ts` | 快照创建/读取/列表；回滚配置与启用状态（不能重装插件）。 | → state/store, gateway, installer |
| 仓库文件 | `services/repo-files.ts` | 把计划结果转成仓库文件集合与删除列表；序列化前清洗行内 `moduleName`/`entryId`（绝对/本地路径替换为包名）；构建基线。 | → manifest, core/paths |
| 扫描 | `scanner/inventory.ts` | 从 plugin manager（主）或 profile `package.json`（降级）生成 `DeviceInventory`；分类来源、计算 `installSpec`、提取过滤后的配置。 | → config-gateway, profiles, core |
| 配置网关 | `scanner/config-gateway.ts` | 通过 `configEditor`（优先）或 `settings`（回退）读写配置；写入前再次脱敏；保留未同步键。 | → core/redact |
| 安装器 | `adapters/installer.ts` | `pluginManager.installBundle` / `setBundleEnabled` / `setPluginEnabled` / `removeBundle`；不允许跨 Profile 操作；返回 `pendingBuilds`。 | → dsh 结构类型 |
| Git | `git/repo-store.ts` | 克隆/刷新工作区、读取 manifest/state/configs/devices、`readAtCommit`、`history`、`testConnection`、事务化写入 + 提交 + 推送 + 重试。 | → git-runner, repo-paths, manifest |
| Git 安全 | `git/git-runner.ts` | 参数数组 + `shell:false`、禁止危险选项、超时/截断、令牌经环境变量、输出脱敏、错误分类（auth/network/其它）。 | → core |
| 布局与路径 | `git/repo-paths.ts` | 仓库布局常量、备份目录归一化、拒绝符号链接/`.git`/逃逸路径的读写。 | → core/paths, manifest |
| 清单 | `manifest/manifest.ts` | schema 版本校验、所有仓库文档的解析与校验、确定性序列化、`metadata/schema.json` 生成；`buildManifest({ generatorVersion })` 与 `buildSchemaDocument(pluginVersion)` 记录**运行中的插件版本**（由 engine 传入 `deps.pluginVersion`），不写死常量。 | → core |
| 本机状态 | `state/store.ts` | 配置/状态 JSON 的原子读写与归一化、设备身份、路径解析、字段校验（仓库 URL、分支名、间隔范围等）。 | → core |
| Web | `http/routes.ts` + `http/api-types.ts` | 14 个 POST 路由与线上契约（`{ok:true,value}` / `{ok:false,error}`）。 | → engine |
| 工具 | `tools/tools.ts` | 6 个工具定义；确认语义；错误归一化为工具结果。 | → engine |
| 浏览器 | `client/src/**` | React 设置页，经 `scripts/build-client.mjs` 打成 `lib/client.js`（`window.__ModuleLoader__.load`），React 由宿主模块表提供。 | 只 `import type` Host 契约 |

> 依赖原则：`plan.ts`、`model.ts`、`core/*` 不依赖 I/O；`repo-store.ts` 是唯一接触 Git 工作区的模块；插件**不**在运行时依赖任何 `@deepseek-ai/*` 包（宿主服务全部走 `ctx.get()` 特性探测）。

## 3. 数据流

### 3.1 状态查询（status / plugins/list / diff）

```text
status(refresh?)
  → ConfigStore.read() + StateStore.read() + persistDeviceIfChanged()
  → scanner.scan(config, activeProfile)            (3 秒扫描缓存)
  → repo.prepare()  (仅 refresh=true) / readManifest + readProfileState + readConfigs + readDeviceSnapshots
  → planSync(...)  → countPlanChanges → StatusView + logs
```

`plugins/list` 用同样的 local/remote 读取，把 `planSync` 的 `diffs` 映射成表格行（`synced` / `local-only` / `remote-only` / `version-diff` / `config-diff` / `enabled-diff` / `conflict` / `excluded`）。`diff` 只调用 `previewBackup` / `previewRestore` / `previewSync`。

### 3.2 备份（scan → plan → execute → baseline）

```text
backup(options)
  mutex.runExclusive({wait:true}); busy=true
  1. config = readConfig(); ensureConfigured()
  2. state = readState(); persistDeviceIfChanged()
  3. store = createRepo(config)                    (workDir = sha256(repoUrl+"\n"+branch)[0..20])
  4. prepared = store.prepare()                    (clone/fetch/reset 工作区)
  5. local = scanLocal(force)                      (DeviceInventory)
  6. read = readRemote(store, prepared.head)       (manifest/state/configs/devices)
  7. plan = planBackup(planInput)                  (push-plugin / push-config / remove-remote)
  8. if plan.requiresConfirmation && !confirmDestructive → SyncError('confirmation-required', {plan})
  9. store.write({ files, deletions, rebuild, message, trailers })
       - rebuild: 推送被并发设备抢先时，重新读取 → 重新 planBackup → 重算文件
       - 内部: 删除旧文件 → 原子写文件 → git add -A → 无变化则结束 → commit(+trailers) → push
 10. baseline = buildBaseline(localAfter, remoteAfter, previous)
 11. state.{lastSyncAt,lastCommit,baselines[profile],conflicts=[],lastOperation} = ...; persist
 12. return OperationResult{ commit, pushed, noChanges, actionOutcomes, warnings }
     （写入的 manifest/schema 的 generator.version = 运行中的插件版本）
```

### 3.3 恢复 / 历史回滚（pull）

```text
restore(options) / rollback({commit})
  mutex; busy=true
  1. config/state; store.prepare()
  2. read = commit ? readAtCommit(commit) : readRemote(head)     (readAtCommit 用 git show 读历史，不动工作区)
  3. local = scanLocal(force)
  4. plan = planRestore(planInput)   → 可选按 pluginIds 过滤 actions
  5. 未解决冲突 → SyncError('conflict-present', {plan})
  6. 无动作 → 直接返回 noChanges
  7. requiresConfirmation（有动作时为真）且未确认 → 'confirmation-required'
  8. snapshot = snapshots.create({operation, inventory: local, configs: filtered})
  9. outcomes = executeLocalActions(plan.actions)     (逐条执行, 单条失败不影响其余)
 10. 失败 → 尽力 tryRollback(snapshot) 回滚配置/启用状态；state.lastError 记录；返回 ok=false
 11. 成功 → 更新 baseline（commit = 指定 commit 或 head）、lastCommit、lastOperation
```

注意：恢复**只写本机**，不产生仓库提交；`restore` 的基线提交指向被恢复的提交（指定 `commit` 时）或分支 head。

### 3.4 双向同步（scan → plan → execute → baseline）

```text
sync(options)
  mutex; busy=true
  1-6. 同备份：prepare → scan → readRemote → planSync
  7. unresolvedConflicts(plan, resolutions) → 'conflict-present'
  8. 无动作 → 更新 lastSyncAt/lastCommit，直接返回 noChanges
  9. 破坏性且未确认 → 'confirmation-required'
 10. localActions 非空 → snapshot
 11. executeLocalActions(plan.actions)              (pull 侧动作)
 12. 有失败 → tryRollback(snapshot)、记录 lastError、返回 ok=false
 13. 有非本机动作 → store.write({ files, deletions, rebuild, trailers })
       rebuild 时重新 scan + 重新 planSync（带 resolutions）再算文件，避免覆盖刚拉到的远端状态
 14. localAfter/remoteAfter → buildBaseline → state 更新
```

### 3.5 自动同步

```text
scheduler.applyConfig(config)   (启动时 + 每次保存配置)
  if !autoSync.enabled → 清除所有定时器，重置 paused/failures
  if repoUrl === '' → pausedReason='no repository configured'
  onStartup → 15s 后 status({refresh:true}) 只读检查（写日志）
  intervalMinutes > 0 → 至少 60s 的定时器，每次运行后重新排期

notifyPluginChange() (来自 index.ts 的 plugin-manager/changed 监听)
  if enabled && onPluginChange → debounce(max(1000, debounceMs)) → run('plugin-change')

run(reason)
  守卫: disabled / busy / engine.isBusy() / paused / 60s 冷却
  mode=backup → engine.backup({confirmDestructive:false})
  mode=restore → engine.restore({confirmDestructive:false})
  mode=two-way → engine.sync({confirmDestructive:false})
  失败: conflict-present / confirmation-required → 暂停；其它 → 退避重试(60s/5m/15m, 最多 3 次)
```

## 4. 本机状态文件

| 路径（`$DSH_HOME/dsh-plugins-git-sync/`） | 写入者 | 内容 |
| --- | --- | --- |
| `config.json` | `state/store.ts` `ConfigStore` | 归一化后的 `SyncConfig`（无秘密；`tokenEnvVar` 只是变量名） |
| `state.json` | `StateStore` | `LocalState`：设备身份、`lastSyncAt`、`lastCommit`、`lastOperation`、`lastError`、`baselines`、`conflicts`、`connection`、`autoSyncFailures` |
| `sync.log` | `core/logger.ts` | JSONL，每行 `{at, level, message, details?}`（已脱敏）；内存环形缓冲 500 条 |
| `snapshots/<id>/snapshot.json` | `services/snapshot.ts` | 快照：`{schemaVersion, createdAt, operation, profile, device, inventory, configs}`；id 形如 `20261028-150501-ab12` |
| `work/<hash>/` | `git/repo-store.ts` | 备份仓库的工作副本；`hash = sha256(repoUrl + "\n" + branch)` 前 20 个十六进制字符；纯缓存，可删除 |
| `archives/` | — | 预留（当前版本不写入任何归档） |

### 基线（baseline）语义

`buildBaseline()` 只在**本机与仓库已经一致**时记录条目：

```text
local 与 remote 都存在，且 version / enabled / configs 全部相等 → 用 local 生成基线条目 {version, enabled, configs, hash}
local 与 remote 至少一方缺失（或 Content 不等）→ 保留上一条基线（若存在），否则不记录
```

基线是「这台设备上次与仓库达成一致的状态」。之后：

- `statesEqual(local, base) === false` ⇒ 本机改过；
- `statesEqual(remote, base) === false` ⇒ 别的设备改过。

这就是三方比较的全部信息来源。

## 5. 双向同步算法

### 5.1 三方比较

```text
localChanged  = !statesEqual(local,  base)
remoteChanged = !statesEqual(remote, base)

statesEqual(a, b) = a 存在性相同 && a.version === b.version
                    && a.enabled === b.enabled
                    && stableStringify(a.configs) === stableStringify(b.configs)
```

`PluginState` 是 `PluginRecord` / `RemotePluginEntry` / `BaselineEntry` 的公共投影（`services/model.ts`），只包含参与同步比较的字段：`id/name/displayName/version/enabled/configs/installSpec/origin/pathOnly/builtIn/syncable/source/rows`。

### 5.2 决策表（`planSync`）

| local | remote | localChanged | remoteChanged | 结果 |
| --- | --- | --- | --- | --- |
| 有 | 有 | 否 | 否 | 无动作（可能记录 `identical` 差异） |
| 有（改动） | 有/无 | 是 | 否 | `push-plugin`（+`push-config`）：把本机状态写进仓库 |
| 有 | 无 | 是 | 否 | 同上；若本机插件不可安装到别的设备，追加警告「仅记录」 |
| 无（本机删除） | 有 | 是 | 否 | 冲突 `local-deleted`；仅当 `allowPluginRemoval && choice==='local'` 时为 `remove-remote`（破坏性） |
| 有/无 | 有（改动） | 否 | 是 | `install/upgrade/downgrade`（+`enable/disable`/`restore-config`）应用远端状态 |
| 有 | 无（远端删除） | 否 | 是 | 冲突 `remote-deleted`；仅当 `allowPluginRemoval && choice==='remote'` 时为 `remove-local`（破坏性） |
| 有 | 有 | 是 | 是 | 若 `statesEqual(local, remote)` → 收敛（无动作）；否则冲突 `both-changed` |
| 无 | 无 | — | — | 无动作 |

冲突解决（`resolution.choice`）：

| choice | 双方都改（均存在） | 本机删除 / 远端仍在 | 远端删除 / 本机仍在 |
| --- | --- | --- | --- |
| `local` | `push-plugin` + `push-config` | `remove-remote`（需 `allowPluginRemoval`，否则仍冲突/跳过） | `push-plugin`（把本机状态推回去） |
| `remote` | 应用远端（install/upgrade/...） | 应用远端（相当于保留远端、忽略本机删除） | `remove-local`（需 `allowPluginRemoval`） |
| `skip`（默认） | 保留冲突 | 保留冲突 | 保留冲突 |
| `manual` | 用 `manualConfig` 写本机配置并推送合并状态（仅本机存在时） | 保留冲突（无本机状态可合并） | 保留冲突（无远端状态可合并） |

恢复（`planRestore`）方向的冲突只有一类：`config-conflict` —— 本机配置自基线后被改过，且与仓库配置不同。它不是「双方都改」意义上的冲突，而是「恢复会覆盖本机未同步的改动」，因此需要用户确认保留哪一侧。

### 5.3 工作示例：Mac 新增 A，Windows 新增 B

初始状态：仓库为空；两台设备都没有插件；两台设备基线为空。

**第 1 步：Mac 安装 A（1.0.0，配置 `{timeout: 30}`）并备份**

```text
local = { A: {version:1.0.0, enabled:true, configs:{timeout:30}} }
remote = {}   base = {}
planBackup → push-plugin A + push-config A          (无破坏性，无需确认)
仓库提交 c1: profiles/desktop/plugins.json += A；configs/a.json = {timeout:30}；devices/<mac>/desktop.json
Mac 基线 = { A: {1.0.0, true, {timeout:30}} }
```

**第 2 步：Windows 同步（本机还没有任何插件）**

```text
local = {}   remote = { A }   base = {}
localChanged(A): statesEqual(local=null, base=null) === true  → false
remoteChanged(A): statesEqual(remote=A, base=null)   === false → true
```

关键点：**新设备的空基线与空本机被视为「没有本地改动」**，所以 `remoteChanged = true` 走「远端改动 → 应用到本机」：`install A@1.0.0` + `restore-config` + `enable`。Windows 现在有 A。

（如果这里反过来把「远端有、本机无」当成「本地删除」，新设备首次同步就会把仓库清空——三方比较的意义正在于此。）

```text
Windows 基线 = { A: {1.0.0, true, {timeout:30}} }
```

**第 3 步：Windows 安装 B（2.0.0，无配置）并同步**

```text
local = { A, B }   remote = { A }   base = { A }
A: local==base==remote → 无动作
B: local 存在, base 无, remote 无 → localChanged=true, remoteChanged=false → push-plugin B
planSync → push-plugin B（+不推送配置，因为 B 无配置）
Windows 落盘前先拉取；store.write 推送 c2（可能被 Mac 抢先时走 rebuild 重算）
Windows 基线 = { A, B }
```

**第 4 步：Mac 同步**

```text
local = { A }   remote = { A, B }   base = { A }
A: 三方一致 → 无动作
B: localChanged=false, remoteChanged=true → install B@2.0.0 + enable
Mac 现在也有 A 和 B；基线更新为 { A, B }
```

**反例：如果两台设备都改了同一个插件的版本**

Mac 把 A 升到 1.1.0 并备份（基线 1.0.0）；Windows 同时把 A 升到 1.2.0 并备份（同一分支，Windows 的推送基于远端 1.1.0 会先拉取重算，此时 Windows 的 base 在本地是 1.0.0、remote 是 1.1.0、local 是 1.2.0）：

```text
Mac:     localChanged=true, remoteChanged=true, local != remote → conflict both-changed
Windows: 同理（它会把 A 从 1.2.0 与本机推不上去）→ 冲突
```

任何一方都不应自动覆盖；用户必须选 `local`（推自己的版本）或 `remote`（用对方的版本），选完才继续。若选择的版本低于本机版本，规划为 `downgrade` 并标记破坏性，需要再次确认。

## 6. 冲突矩阵（呈现给 UI 的字段）

每个 `ConflictInfo` 包含：`pluginId`、`pluginName`、`reason`、`fields`（`version` / `enabled` / `config.<key>` / （不展示 `presence`））、`localVersion`、`remoteVersion`、`localEnabled`、`remoteEnabled`、`localConfig`/`remoteConfig`/`baseConfig`、`remoteDevice`（最后修改设备 ID）、`remoteUpdatedAt`。

| reason | 含义 | 典型 `fields` |
| --- | --- | --- |
| `both-changed` | 双方都改了同一插件且仍不一致 | `version`、`enabled`、`config.timeout` |
| `local-deleted` | 本机删了、远端还在/被改 | 通常为空或 `version`/`config.*` |
| `remote-deleted` | 远端标记删除、本机还在/被改 | 同上 |
| `config-conflict` | 恢复会覆盖本机未同步的配置改动 | `config.<key>` |

`plan.diffs` 另外给 UI 一个逐插件视图（`kind`: `missing-local` / `missing-remote` / `version-diff` / `config-diff` / `enabled-diff` / `deleted-remote` / `new-local` / `new-remote` / `identical`），`conflict?` 挂在对应 diff 上。

## 7. 安全不变量（实现层面的强制点）

| 不变量 | 强制位置 |
| --- | --- |
| 无 shell 注入 | `git/git-runner.ts`：参数数组、`spawn(shell:false)`、拒绝 NUL 与危险选项 |
| 令牌不进入 argv / 配置文件 | `git/git-runner.ts`：`GIT_CONFIG_*` + 临时 credential helper，令牌仅在子进程环境变量中 |
| 认证失败与网络失败分类 | `classifyGitFailure()`：auth（不可重试）/ network（可重试）/ 其它 `git-failed` |
| 输出不撑爆内存、不挂死 | 1 MiB 捕获上限；默认 120s 超时后 `SIGKILL`；`GIT_TERMINAL_PROMPT=0` |
| 路径不逃逸、不写 `.git`、不穿符号链接 | `core/paths.ts` + `git/repo-paths.ts`（读与写都校验） |
| 仓库文档结构可信 | `manifest/manifest.ts` 全套校验；schema 版本不匹配明确报错 |
| 秘密不落仓库/日志 | `core/redact.ts`（键名 + 值形态 + URL userinfo）；日志与 Git 错误统一脱敏 |
| 绝对路径不落仓库 | **序列化层强制**：`services/repo-files.ts` `sanitizePluginRecord()` 删除 `localPath`，`sanitizeRows()` / `sanitizeModuleName()` 把行里的 `moduleName` / `entryId`（绝对 `file:///…`、盘符、以 `/` 或反斜杠开头、含反斜杠、控制字符）替换为插件包名或丢弃；`toRemoteEntry()` 与 `toDeviceSnapshot()` 都经过它（真实插件会以 `file:///…` 引用模块，例如 cc-safety-net）；扫描器另外只保留相对 `source` |
| 不产生空提交 | `repo-store.materialize()`：`git status --porcelain` 为空即返回 `changed:false` |
| 不覆盖并发设备 | `repo-store.write()`：非快进 → refresh → `rebuild()` 重算 → 重试；超限报 `git-push-rejected` |
| 破坏性操作需确认 | 引擎 `backup`/`restore`/`sync`/`runRestore` 在 `requiresConfirmation` 时抛 `confirmation-required` |
| 改动前有快照 | `engine.sync` / `engine.runRestore`：执行本机动作前 `snapshots.create()` |
| 串行执行 | `core/mutex.ts` + 引擎 `busy` 标志；调度器另有 `running`/冷却 |
| 失败不留半截状态 | `state.lastError` 记录；同步/恢复失败时尽力回滚配置与启用状态；基线只在成功后更新 |

> 信任边界：备份仓库的用户（或能写该仓库的人）可以决定本机安装哪些包（`installSpec` 会被传给 DSH 插件管理器）。这等价于「信任你同步的插件来源」。请使用私有仓库、审阅恢复/同步预览，并依赖 DSH 插件管理器自身的来源限制。

## 8. HTTP 接口（设置页 ↔ Host）

- 前缀：`/api/dsh-plugins-git-sync`
- 全部为 **POST**，请求体 JSON（上限 1 MiB），响应统一信封：
  - 成功：`{ "ok": true, "value": <payload> }`
  - 失败：`{ "ok": false, "error": { "code": <SyncErrorCode>, "message": <本地化消息>, "details"?: <JSON> } }`
- 路由注册在宿主的 `connection.fetch.register` 上，因此沿用宿主的同源/登录校验，不另造鉴权。

| 路由 | 请求体 | 返回 `value` |
| --- | --- | --- |
| `status` | `{refresh?: boolean}` | `{ status: StatusView, logs: LogEntry[] }` |
| `config/save` | `{config: Partial<SyncConfig>}` | `{ config: SyncConfigView }` |
| `connection/test` | `{config?: Partial<SyncConfig>}` | `ConnectionTestResult` |
| `plugins/list` | `{}` | `{ rows, activeProfile, availableProfiles }` |
| `diff` | `{direction?: 'push'\|'pull'\|'two-way', commit?: string}` | `{ direction, plan: SyncPlan }` |
| `backup` | `{message?: string, confirmDestructive?: boolean}` | `OperationResult` |
| `restore/preview` | `{commit?: string}` | `{ plan, snapshotPlanned, source }` |
| `restore` | `{commit?, pluginIds?, resolutions?, confirmDestructive?}` | `OperationResult` |
| `sync/preview` | `{}` | `{ direction: 'two-way', plan: SyncPlan }`（与 `SyncPreviewResponse = DiffResponse` 契约一致；设置页读取 `plan`） |
| `sync` | `{resolutions?, confirmDestructive?}` | `OperationResult` |
| `history` | `{limit?: number}` | `{ entries: HistoryEntry[], lastOperation }` |
| `rollback` | `{commit, resolutions?, confirmDestructive?}` | `OperationResult` |
| `auto-sync` | `{enabled, mode?, intervalMinutes?, onStartup?, onPluginChange?, debounceMs?}` | `{ status: StatusView }` |
| `logs` | `{limit?: number}` | `{ entries: LogEntry[] }` |

浏览器侧入口在 `client/src/api.ts`（相对路径 `api/dsh-plugins-git-sync/<route>`，`credentials: 'same-origin'`）。`confirmation-required` / `conflict-present` 错误的 `details.plan` 会被客户端取出并渲染为确认对话框。

## 9. Agent 工具契约

`tools/tools.ts` 用同一个 `ToolDefinition` 结构注册；`execute` 内只调用引擎方法，错误经 `errorResult()` 归一化：

- `SyncError('confirmation-required' | 'conflict-present')` → 返回 `{ ok: true, requiresConfirmation: true, needsUserDecision: true, reason, plan }`（不是工具崩溃）；
- 其它 `SyncError` → `{ ok: false, error: { code, message } }`；
- 未知异常 → `{ ok: false, error: { code: 'internal', message } }`。

工具的超时（`timeoutMs`）与并发安全标记见 README 的工具表；只读工具（status/diff/history）标记为可并发，其余串行。

## 10. 扩展点

| 想做的事 | 改动位置 | 注意 |
| --- | --- | --- |
| **本地插件归档与恢复** | 扫描器在 `PluginRecord.archive` 填 `PluginArchive`；`repo-files.ts` 写入/读取 tarball；`plan.ts` 为本机/远端本地插件生成 `installSpec = "backup-tarball:<path>"`；`engine.resolveTarballSpec()` 已支持该前缀（`executor.ts` 也会走它）；恢复前校验 `sha256`/`size` | 归档内容会进仓库，注意体积上限（`MAX_BACKUP_FILES`）与解包/路径安全；平台差异仍需警告 |
| **多 Profile 同步** | `SyncConfig.profiles` 已存在（当前被归一化为「当前 profile 在前」）；需要把 `engine` 里所有 `this.deps.activeProfile` 换成「遍历 profiles」的上下文，并让基线/状态按 profile 存（`state.baselines` 已是 map）；安装器 `requireActiveProfile()` 需要放宽或改为按 profile 路由 | 先在 DSH 侧确认跨 Profile 安装/启停的 API 是否可用 |
| **新认证方式** | `types.ts` 的 `GitAuthMode`、`state/store.ts` 归一化、`index.ts` 的 `tokenProvider`/`git-runner` 环境注入、`client` 配置表单 | 任何凭据都应只存在于环境/子进程运行时，不落配置与日志 |
| **新动作类型** | `types.ts` `PlanActionKind`、`plan.ts` 生成、`executor.ts` 执行（本机动作）或 `repo-files.ts`（仓库动作）、UI 的 `planKind*` 文案 | 破坏性动作必须 `destructive: true` 并让引擎要求确认 |
| **新 HTTP 路由** | `http/api-types.ts` 的 `ApiRouteName` + `http/routes.ts` 的 `handlers` + `client/src/api.ts` | 保持 POST + 信封；错误用 `SyncError` 以便统一映射 |
| **新 Agent 工具** | `tools/tools.ts` `buildToolDefinitions()` | 只调用引擎；确认语义复用 `CONFIRM_PARAMETER` |
| **新语言 / 文案** | `locale/<lang>.json`（插件清单标题/描述）、`client/src/i18n.ts`（设置页字典）、`README*` | 字典键集合以 `zh` 为准，`en` 必须齐全 |
| **清单 schema 迁移** | `constants.ts` `MANIFEST_SCHEMA_VERSION`、`manifest.ts`（读旧版本 → 迁移 → 写新版本）、`locals.ts` 版本提示文案 | 旧版本插件读到新 schema 必须拒绝写入并提示升级 |
| **平台兼容判断** | 扫描器已记录 `platform`、远端条目的 `updatedBy`→设备快照可查平台；可在 `planInput()` 生成警告处扩展 | 不要静默跳过插件，至少给警告 |

## 11. 测试结构

| 目录 | 覆盖内容 |
| --- | --- |
| `tests/unit/core.test.ts` | 路径安全、脱敏（键名/值/URL）、版本比较、JSON 稳定性、配置归一化、持久化、日志 |
| `tests/unit/plan.test.ts` | 备份/恢复/双向同步规划与冲突决策（纯函数） |
| `tests/unit/scanner.test.ts` | 来源分类、`installSpec`、内置插件、符号链接本地插件、排除列表、Profile 清单回退、配置过滤 |
| `tests/unit/config-gateway.test.ts` | `configEditor` / `settings` 两条读写路径、秘密过滤、错误处理 |
| `tests/unit/manifest.test.ts` | 清单构建/校验/确定性序列化 |
| `tests/unit/git-runner.test.ts` | Git 参数校验（NUL/选项注入）、无 shell、超时、输出截断、令牌只进环境、错误分类与脱敏 |
| `tests/unit/repo-store.test.ts` | 克隆/刷新、事务化写入、无变化不提交、非快进重试与 `rebuild()`、history 解析、readAtCommit |
| `tests/unit/repo-files.test.ts` | 序列化边界的机器路径清洗（`sanitizeModuleName`/`sanitizePluginRecord`/`toRemoteEntry`）、配置仅在变化时重写、版本化布局 |
| `tests/unit/tools.test.ts` | 恰好注册 6 个工具、工具结果是无损 JSON、两阶段确认（预览后才执行）、错误归一化 |
| `tests/unit/routes.test.ts` | HTTP 面：文档化的路由全部 POST、`{ok,value}`/`{ok,error}` 信封、非法请求体、`direction` 透传与返回形状、破坏性确认带 plan、未知错误不泄露细节 |
| `tests/unit/scheduler.test.ts` | 自动同步调度：关闭时不动作、按间隔运行所选模式、冲突暂停、失败退避、变更防抖、引擎忙时跳过、启动检查、dispose 清理定时器 |
| `tests/client/render.test.tsx` | 设置页 jsdom 渲染冒烟：挂载与初始 Host 调用、状态/仓库配置/插件列表分区渲染、`confirmation-required` 时打开确认对话框（**不是**真实 Harness 页面） |
| `tests/integration/two-device.test.ts` | 两台模拟设备 + 真实本地 bare Git 仓库的端到端流程：备份/恢复、无变化不提交、并发新增、版本变更、配置冲突、删除确认、历史 trailer、非法 manifest、不可达仓库、本地插件排除、状态计数 |

集成测试只模拟宿主服务（plugin manager、config editor），扫描器、配置网关、安装器适配、Git runner、repo store、manifest 校验、引擎、快照、历史都是真实代码。最终一次验证：`npm run typecheck`、`npm run build`、`node --check lib/client.js` 与 `npx vitest run`（**13 个测试文件 / 191 个测试**）全部通过；jsdom 渲染测试只证明页面能挂载与交互，不能替代真实 Harness 页面的人工验证。
