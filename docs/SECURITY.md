# 安全模型 / Security

本文说明 **DSH 插件 Git 同步（`dsh-plugins-git-sync`）** 的威胁模型、脱敏规则、Git 子进程加固、路径校验、日志脱敏，以及「永远不会上传什么」。用户视角的安全说明见 [README.md 第 11 节](../README.md#11-安全与隐私)。

This document describes the threat model, secret-filtering rules, Git subprocess hardening, path validation, log redaction, and what is never uploaded. See [README_EN.md section 11](../README_EN.md#11-security-and-privacy) for the user-facing summary.

---

## 1. 资产与信任边界

| 资产 | 位置 | 保护方式 |
| --- | --- | --- |
| HTTPS 访问令牌 / SSH 私钥 | DSH 进程环境、系统凭据管理器、ssh-agent | 本插件**不保存、不读取内容**；HTTPS 令牌只按环境变量名在子进程环境里取值；SSH 由系统 Git 处理 |
| 插件配置中的潜在秘密 | 宿主配置 / settings | 进入备份前按「键名 + 值形态」双向过滤；写回前再次过滤 |
| 备份仓库（含插件清单） | 用户自己的 Git 仓库（建议私有） | 只写白名单字段；不写绝对路径；不写秘密；提交历史可审计 |
| 本机数据目录 | `$DSH_HOME/dsh-plugins-git-sync/` | 目录 `0700`、文件 `0600`、原子写入（临时文件 + rename） |
| 本机快照 | 同上 `snapshots/` | 只含过滤后的配置与插件清单；用于失败回滚 |
| 日志 | `sync.log` + 宿主日志 | 写入前统一脱敏 |

**信任边界**：

1. **本机 DSH 进程**：受信任。同用户进程可读取它的环境变量（包括令牌变量）——这是操作系统的既有边界，本插件无法改变。
2. **备份仓库**：**不可信**。它可能被其他设备、旧版本插件、手工操作甚至恶意方写入；所有读取都经过结构校验与路径校验，任何不符合 schema 的内容都会被拒绝。
3. **插件安装来源**：备份仓库中的 `installSpec` 会被交给 DSH 插件管理器执行安装。**能写备份仓库的人，等价于能为你的设备选择安装哪些包**。请使用私有仓库、审阅恢复/同步预览，并依赖 DSH 插件管理器自身的来源限制。
4. **Web 设置页**：受宿主登录/同源策略保护（路由注册在宿主 `connection.fetch.register` 上），插件不另造鉴权，也不接受跨源请求。

## 2. 威胁模型（STRIDE 视角）

| # | 威胁 | 场景 | 缓解措施 |
| --- | --- | --- | --- |
| T1 | **恶意/损坏的仓库内容** | 仓库中的 `manifest.json`、`plugins.json`、配置文件被手工改坏或被注入恶意值（超长字符串、非法 ID、`..` 路径、符号链接、`.git` 目录） | `manifest.ts` 全套结构校验；schema 版本不匹配明确报错；`repo-paths.ts` 拒绝绝对路径/`..`/盘符/scheme/NUL/`.git`/`GIT~1`/符号链接；读取走 `lstat` 不跟随符号链接；文件数量与设备数有上限 |
| T1b | **本机路径泄露到共享仓库** | 插件行（row）通过绝对 `file:///…` URL 引用模块（真实环境中的 cc-safety-net 就是这样），把这个设备相关路径写进仓库 | **序列化层强制清洗**：`services/repo-files.ts` 的 `sanitizeModuleName()` / `sanitizeRows()` / `sanitizePluginRecord()` 把绝对路径、盘符、以 `/` 或反斜杠开头、含反斜杠或控制字符的 `moduleName` / `entryId` 替换为插件包名或丢弃；`toRemoteEntry()`（共享状态）与 `toDeviceSnapshot()`（设备快照）都经过它，不只依赖扫描阶段 |
| T2 | **秘密泄露到仓库** | 某个插件配置项是 API key / 密码 / 私钥，被同步进仓库 | 键名规则 + 值形态规则双向过滤；命中项只记录**键名**（`configSkipped`）；写回前二次过滤；settings 服务声明的 secret 路径额外剔除 |
| T3 | **秘密泄露到日志/UI** | Git 错误输出里带 token（URL userinfo、credential helper 输出）、日志 details 里带配置 | 所有日志消息经 `redactText`、details 经 `redactJson`；Git 错误在分类前先脱敏；认证方式只显示方法名 |
| T4 | **命令注入 / 选项注入** | 仓库 URL、分支名、提交哈希或插件名被拼进 shell 命令或作为 Git 选项 | 永远用参数数组 + `shell:false`；拒绝 NUL、以 `-` 开头的子命令、`-c`、`--upload-pack` 等；提交哈希必须 `^[0-9a-fA-F]{4,64}$`；分支名与仓库 URL 单独校验 |
| T5 | **覆盖其他设备的数据** | 两台设备同时推送；或实现里图省事 force push | 永不 force push；非快进 → 拉取 → `rebuild()` 重算 → 重试（默认 3 次）→ 明确失败 `git-push-rejected` |
| T6 | **误删本机插件** | 恢复把备份里没有的插件删掉；或两侧删除被自动执行 | 恢复从不删除备份中没有的本机插件；删除类动作一律 `destructive` 且需要确认；`allowPluginRemoval` 默认关闭；远端删除只产生冲突/警告 |
| T7 | **Agent 通过工具静默破坏** | 模型直接调用工具执行破坏性计划 | 工具两阶段：`confirm` 缺省返回预览；引擎仍校验 `confirmDestructive`；删除/降级必须显式确认 |
| T8 | **跨 Profile 越权修改** | 恢复把插件装进别的 Profile | `installer.requireActiveProfile()` 只允许当前 Profile；引擎只扫描/写入 `activeProfile` |
| T9 | **令牌泄露给第三方** | 令牌被写进仓库 URL、日志、或通过网络发到非目标服务 | 令牌只用于 Git 子进程环境；保存配置时拒绝含 userinfo 的 URL；仅在 `https-token` 模式下注入 |
| T10 | **本机文件被窃取** | 同机其他用户读取配置/状态/日志 | 数据目录 `0700`、文件 `0600`；配置**不含**秘密；日志已脱敏 |
| T11 | **供应链（仓库→安装包）** | 攻击者写仓库，让设备安装恶意 npm/git 包 | 属于设计上的信任边界：预览确认、私有仓库、插件管理器自身的 registry 限制；不做静默安装 |
| T12 | **自动化被滥用** | 自动同步在后台反复执行破坏性操作 | 自动同步默认关闭；破坏性计划/冲突/未配置仓库都会暂停；互斥 + 冷却 + 退避 |
| T13 | **路径穿越写入仓库外** | 备份路径逃逸工作区 | `safeJoin()` 解析后校验前缀；写入/删除前逐段 `lstat` |

**明确不在防护范围内的**：

- 同用户进程读取 DSH 环境变量 / 内存（操作系统边界）；
- 有仓库写权限的人决定安装哪些插件（信任边界，见 T11）；
- 你自己的插件本身的行为；
- 备份仓库的静态加密（由 GitHub/你选择的托管方负责）；
- 启发式脱敏的漏报（见第 3.4 节）。

## 3. 秘密过滤规则

实现位于 `src/core/redact.ts`，在三个位置调用：

1. **扫描时**（`scanner/config-gateway.ts` 读取后）→ 决定哪些配置进入 `PluginRecord.configs`；
2. **写回时**（`config-gateway.write()`）→ 二次过滤，秘密值不会被写回宿主；
3. **日志/错误**（`core/logger.ts`、`git/git-runner.ts`）→ 文本与 JSON 脱敏。

### 3.1 键名规则

大小写不敏感；命中以下任一条即视为敏感：

- 正则（分段匹配，`^`/`$` 或 `[._-]` 边界）：`api[_-]?key`、`apikey`、`token`、`secret`、`password`、`passwd`、`pwd`、`credential(s)`、`auth`、`cookie(s)`、`session[_-]?key`、`private[_-]?key`、`access[_-]?key`、`access[_-]?token`、`refresh[_-]?token`、`client[_-]?secret`、`bearer`、`signature`、`signed[_-]?url`、`webhook[_-]?url`；
- 子串提示：`apikey`、`api_key`、`accesskey`、`access_key`、`secretkey`、`secret_key`、`privatekey`、`private_key`、`authorization`、`auth_token`、`authtoken`、`x-api-key`、`encryptionkey`、`encryption_key`、`ssh_key`、`sshkey`。

匹配对象既包括**当前键名**，也包括**点分路径**（`nested.apiKey` 里的 `nested.apiKey` 与 `apiKey` 都会被检查）；数组元素用索引作为路径段。

### 3.2 值形态规则

无论键名是什么，长度 ≥ 8 的字符串命中以下任一模式即丢弃：

| 模式名 | 正则（语义） |
| --- | --- |
| `private-key` | `-----BEGIN [A-Z ]*PRIVATE KEY-----` |
| `openai-key` | `sk-[A-Za-z0-9_-]{20,}` |
| `github-token` | `ghp_/gho_/ghu_/ghs_/ghr_` + 20 位以上 |
| `github-pat` | `github_pat_` + 20 位以上 |
| `gitlab-token` | `glpat-` + 16 位以上 |
| `slack-token` | `xox[abposr]-` + 10 位以上 |
| `aws-key` | `AKIA` + 16 位大写字母数字 |
| `bearer-header` | `Bearer ` + 20 位以上 |
| `jwt` | 三段式 `eyJ...` JWT |
| `url-userinfo` | `scheme://user:pass@` |

### 3.3 结构处理

- **对象**：只遍历原型为 `Object.prototype` / `null` 的普通对象；类实例、函数、`undefined`、`NaN` 等非 JSON 值直接丢弃；
- **数组**：逐项过滤，丢弃的项被跳过（数组可能变短）；
- **顶层键被判定为敏感**：整个值丢弃，键名记入 `skippedKeys`（只记键名，不记值）；
- **嵌套键被判定为敏感**：该子键丢弃，其父键保留其余内容；
- **写回时**：`filterSensitiveConfig(values).values` 为空则直接返回，不触碰宿主服务；非 JSON 值抛 `invalid-config`。

另有一条**不属于「秘密」但同属敏感**的清洗：插件行的 `moduleName` / `entryId` 若是绝对 `file:///…`、Windows 盘符、以 `/` 或反斜杠开头、含反斜杠或控制字符，序列化写入仓库前会被替换为插件包名（或丢弃）；这条规则在 `services/repo-files.ts` 的序列化边界执行，设备快照同样适用。

### 3.4 已知漏报与代价

规则是**启发式、有意的有损过滤**：宁可少同步一个配置项，也不上传一个秘密。

- 一个既不像凭据键名、值也不匹配任何模式的秘密（例如一段随机字符串放在 `theme.options.custom` 里）**可能**被同步；
- 反过来，键名/值形态「太像秘密」的正常配置（例如 `tokenizer: "..."`、以 `sk-` 开头的普通字符串）**可能**被误过滤；
- 因此：**不要把秘密放进会被同步的插件配置**；同步前检查「检查差异」与仓库内容；对敏感插件使用 `excludedConfigPlugins` 排除其配置。

## 4. Git 子进程加固

实现位于 `src/git/git-runner.ts`，所有 Git 调用（clone/fetch/reset/checkout/show/log/push/ls-remote/remote/update-ref/rev-parse/add/status/commit）都经过它。

| 防线 | 实现 |
| --- | --- |
| 无 shell | `spawn(gitPath, args, { shell: false })`；参数必须是字符串数组，拒绝 NUL 字节与空参数 |
| 拒绝危险选项 | `--upload-pack`、`--receive-pack`、`--exec-path`、`--config-env`、`--git-dir`、`--work-tree`；拒绝以 `-` 开头的子命令（`--version` 除外）；拒绝 `-c`（Git 配置通过 `GIT_CONFIG_*` 环境接口传递） |
| 无交互 | `GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`、`GIT_EDITOR=true`、`GIT_OPTIONAL_LOCKS=0`（并发读更安全） |
| 稳定输出解析 | `LC_ALL=C`、`LANG=C` |
| 超时 | 单条命令默认 120 秒；超时 `SIGKILL` 并返回退出码 124（分类为 `git-network`，可重试） |
| 输出上限 | stdout/stderr 各最多捕获 1 MiB，超出截断并标记 |
| 取消 | 尊重 `AbortSignal`，取消时 `SIGKILL` 并抛 `SyncError('cancelled')` |
| 令牌传递 | `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` 注册一次性 `credential.helper`，helper 从 `DSH_GIT_SYNC_USER` / `DSH_GIT_SYNC_TOKEN` 环境变量读取；令牌**从不进入 argv**（因此不出现在 `ps`/进程列表） |
| 错误分类 | `classifyGitFailure()`：认证类（`git-auth-failed`，不可重试）、网络类（`git-network`，可重试）、其它（`git-failed`）；分类前先 `redactText` |
| 平台 | `windowsHide: true`，避免弹出控制台窗口 |

> 说明：令牌放在子进程环境变量中是**该模型下唯一不落盘、不进 argv 的方式**；同用户进程理论上可读取环境变量，这是操作系统的既有能力。请使用最小权限、可撤销、短有效期的令牌，或改用 SSH。

## 5. 路径与标识校验

| 校验对象 | 规则 | 位置 |
| --- | --- | --- |
| 仓库内相对路径 | 非空、≤1024、无 NUL、非绝对路径、非盘符、非 URL scheme、无 `..`/`.`/空段 | `core/paths.ts` `isSafeRelativePath()` |
| 拼接 | `safeJoin()` 解析后必须仍在根目录内（防 `..` 与符号链接组合逃逸） | `core/paths.ts` |
| 备份目录配置 | 归一化为仓库内相对路径（`''`/`'.'`/`'a/b'`），非法即 `invalid-config` | `normalizeBackupDir()` |
| 写入目标 | 拒绝写入 `.git` / `GIT~1`；逐段 `lstat` 拒绝符号链接；文件内容必须是字符串 | `git/repo-paths.ts` |
| 读取 | `lstat` 拒绝符号链接；必须是普通文件/目录 | `repo-paths.ts` `readWorkTreeFile()` / `listDirectoryEntries()` |
| 仓库 URL | 允许 `https/http/ssh/git/file/sftp`、scp 形式、本地路径；**拒绝 userinfo**；拒绝控制字符；≤2048 | `state/store.ts` `validateRepoUrl()` |
| 分支名 | 保守的 `git check-ref-format` 子集（拒绝 `..`、`@{`、空白、`~^:?*[]`、`\`、首尾 `/`、`-` 开头等） | `isSafeBranchName()` |
| Profile 名 | `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` | `isSafeProfileName()` / `isSafeProfileSegment()` |
| 设备 ID | `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`（作为目录名） | `DEVICE_ID_PATTERN` |
| 插件 ID（文件名） | 拒绝控制字符、≤512；文件名由 `safeFileName()` 规范化 | `assertPluginId()` / `safeFileName()` |
| 行内 `moduleName` / `entryId` | 命中绝对 `file:///…`、盘符、以 `/` 或反斜杠开头、含反斜杠、超长（>256）、控制字符 → 替换为插件包名或丢弃 | `repo-files.ts` `sanitizeModuleName()` / `sanitizeRows()` |
| 提交哈希 | `^[0-9a-fA-F]{4,64}$` | `engine.readAtCommit()` / `repo-store.assertRevision()` |
| 快照 ID | `^[A-Za-z0-9._-]{1,120}$`，拒绝 `.`/`..` | `snapshot.ts` `assertSnapshotId()` |

仓库路径以「备份目录」为根：调用方可以给「仓库相对路径」或「备份目录相对路径」，两种形式都会被归一化并确认落在备份目录内。

## 6. 日志脱敏

`core/logger.ts` 的每一次写入都会：

1. `safeMessage = redactText(message)`：替换 PEM 私钥、各类 token、`Bearer …`、`password = …` 之类的赋值、URL userinfo；
2. `safeDetails = redactJson(details)`：递归处理 JSON，**键名命中敏感规则时整值替换为 `[redacted]`**，字符串值再走 `redactText`；
3. 写入内存环形缓冲（默认 500 条）、`sync.log`（JSONL，`0600`）和宿主 logger；
4. UI 只读取最近的条目（状态接口 50 条、日志接口默认 100 条），读到的都是脱敏后的内容。

此外：

- Git 错误在分类前先 `redactText`，错误消息只保留一行摘要（≤400 字符）；
- 认证方式在状态里显示为方法名（如 `HTTPS token from $GITHUB_TOKEN`、`SSH agent / key`、`system Git credential helper`），不含令牌；
- 提交主题最多 200 字符并去除控制字符；trailer 值最多 500 字符；
- 数据目录路径在 UI 中用 `~` 折叠显示。

## 7. 永远不会上传的内容

- Token、密码、私钥、Cookie、Session Key、API key 等任何命中脱敏规则的键/值；
- 机器绝对路径（`localPath` 只在内存/本机使用，写入仓库前被剥离；`source` 只保留相对/可复现形式；插件行里的 `moduleName` / `entryId` 若是 `file:///…` 或其它本地路径，在序列化层被替换为包名或丢弃，共享状态与设备快照都一样）；
- 仓库 URL 中的用户名/密码（保存时即拒绝带 userinfo 的 URL）；
- 你的全局 Git 身份（提交作者由设备名 + 设备 ID 生成，不读 `user.name`/`user.email`）；
- 宿主日志、环境变量的完整内容（插件只读自己需要的少数服务与两个约定变量名）；
- 插件源码、node_modules、构建产物（备份只保存清单与配置）。

**会上传**：插件包名、版本、来源类型、`installSpec`、启用状态、bundle 行、过滤后的配置、设备名称/平台/架构/DSH 版本/插件版本、时间戳。请把备份仓库当作「你的插件清单」来保护，优先使用私有仓库。

## 8. 数据静态保护

- 数据目录 `0700`、文件 `0600`，写入使用「临时文件 + `fsync` + `rename`」原子替换；
- `config.json` **不含**任何秘密（只有令牌环境变量名）；
- `state.json` 与快照里的配置都已经过过滤器；
- `sync.log` 已脱敏，但仍建议按普通日志对待（可能包含插件名、时间、`~` 路径）；
- `work/` 是备份仓库的工作副本，权限继承自数据目录；
- 令牌不写入任何本机文件。

## 9. 漏洞报告 / Reporting a vulnerability

请**不要**在公开 issue 中披露令牌、私钥或可复现的敏感数据。

1. 首选：在 GitHub 仓库的 **Security → Report a vulnerability**（GitHub Security Advisories）提交私密报告。仓库地址见 `package.json` / 本仓库 README 的 GitHub 链接。
2. 若无法使用私密报告：开一个**不含敏感细节**的 issue，说明受影响的版本、影响面（例如「配置过滤可能泄露某类键」）与希望的联系方式，维护者会联系你。
3. 请尽量提供：插件版本（`package.json`）、DSH 版本、操作系统、最小复现步骤、相关日志片段（**先自行脱敏**）。

维护者会尽力在合理时间内确认与修复；本项目不提供漏洞赏金。修复发布后会在 [CHANGELOG.md](../CHANGELOG.md) 的 Security 段落中说明（在修复可用之后）。

## 10. 安全相关的已知限制

- 脱敏是启发式的，存在漏报（见 3.4）；请勿把秘密放进会被同步的配置；
- 备份仓库的写权限 = 决定安装哪些插件的能力（信任边界，见 T11）；
- 令牌放在子进程环境变量中，同用户进程可读（操作系统边界）；
- 插件不校验 Git 版本、不校验 `installSpec` 指向的包内容（交给 DSH 插件管理器与 registry 的完整性校验）；
- 插件不做传输层之外的额外加密：仓库安全由 GitHub/你的托管方负责；
- 当前版本只同步当前激活 Profile（见 README 已知限制）；
- Agent 工具以当前用户的 DSH 权限运行，破坏性操作虽有确认闸门，但确认后即执行。
