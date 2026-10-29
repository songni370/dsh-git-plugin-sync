# DSH 插件 Git 同步（dsh-git-plugin-sync）

**中文名**：DSH 插件 Git 同步　**英文名**：DSH Plugin Git Sync　**包名 / 仓库名**：`dsh-git-plugin-sync`

用 **Git 仓库**备份、恢复，并在多台设备之间同步 **DeepSeek Harness（DSH）插件清单与插件配置**的 DSH 插件。

> ⚠️ 定位先说清楚：这是**用 Git 管理 DSH 插件**的工具，不是「同步 Git 插件」的工具，也不会去管理你其它 Git 仓库。它只在插件清单 / 版本 / 启用状态 / 经过过滤的插件配置这一层工作；你自己的插件源码仓库、DSH 本体、Node 运行时都不在它的职责范围内。

同步仓库里的内容会写成一份可读的 JSON 清单（`manifest.json` 是索引），所以即使没有本插件，你也可以用普通 Git 工具查看、对比、回滚这份备份。

- 用户文档：本文件（[English](README_EN.md)）
- 维护者文档：[架构说明](docs/ARCHITECTURE.md) · [安全模型](docs/SECURITY.md) · [发布流程](docs/PUBLISHING.md)
- 变更记录：[CHANGELOG.md](CHANGELOG.md)

---

## 目录

1. [项目简介](#1-项目简介)
2. [功能特性](#2-功能特性)
3. [兼容性](#3-兼容性)
4. [安装](#4-安装)
5. [快速开始：连接 GitHub 私有仓库](#5-快速开始连接-github-私有仓库)
6. [备份 / 恢复 / 同步 / 检查差异](#6-备份--恢复--同步--检查差异)
7. [冲突处理](#7-冲突处理)
8. [自动同步](#8-自动同步)
9. [Agent 工具](#9-agent-工具)
10. [备份仓库结构与 Manifest Schema](#10-备份仓库结构与-manifest-schema)
11. [安全与隐私](#11-安全与隐私)
12. [数据与本机文件位置](#12-数据与本机文件位置)
13. [已知限制与 DSH API 限制](#13-已知限制与-dsh-api-限制)
14. [故障排查](#14-故障排查)
15. [开发](#15-开发)
16. [发布](#16-发布)
17. [路线图](#17-路线图)
18. [许可证](#18-许可证)

---

## 1. 项目简介

DSH 插件装得越多，「换台电脑重新装一遍」就越痛苦：插件清单、版本、启用状态、每个插件的配置项，全靠记忆和截图。本插件把这件事交给一个**你自己的私有 Git 仓库**：

- 在设备 A 上「备份」→ 本机插件状态被提交并推送到你的 Git 仓库；
- 在设备 B 上「恢复」→ 按仓库里的清单把插件装回来、把版本对齐、把配置写回去；
- 两台设备都在用时「同步」→ 双向合并，只把真正的变化传过去，冲突一律停下来问你。

备份用的是可读、可 diff、可回滚的 JSON，提交带 `Operation` / `Device-Id` / `Profile` 等 trailer 元数据，历史一眼能看出「哪台设备、什么时候、做了什么」。

### 名称与标识

| 用途 | 值 |
| --- | --- |
| 插件显示名（中文） | DSH 插件 Git 同步 |
| 插件显示名（英文） | DSH Plugin Git Sync |
| 设置页导航标签 | 「插件备份」/「Plugin Backup」 |
| 插件页标签 | 「备份」/「Backup」 |
| npm 包名 / GitHub 仓库名 | `dsh-git-plugin-sync` |
| 备份清单 schema 版本 | `1` |

## 2. 功能特性

| 能力 | 说明 |
| --- | --- |
| **插件扫描（仅用户安装的插件）** | 以 DSH 插件管理器（plugin manager）为主要来源，读取每个插件的包名、版本、来源、可复现安装规格（`installSpec`）、启用状态、bundle 行（rows）和经过过滤的配置；插件管理器不可用或返回空时，回退读取 Profile 的 `package.json` 依赖（降级但可用）。**备份对象仅限用户后装的第三方插件**：DSH 内置/官方插件、DSH 加载器内部条目（`cordis:*`）以及本插件自身都不参与备份，也不会出现在可选插件列表里。 |
| **Git 仓库备份 / 恢复** | 备份把本机状态写进仓库并推送（无变化时不产生空提交）；恢复按仓库清单安装、升级/降级、启停插件并写回配置，**绝不删除备份里没有的本机插件**。 |
| **双向同步与基线** | 本地记录一份「上次与仓库达成一致」的基线（baseline），用 base / local / remote 三方比较判断「是本机改的」还是「别的设备改的」，只推送本机改动、只应用远端改动。 |
| **冲突处理** | 双方都改了、或一方删除另一方修改时，**绝不自动裁决**：生成冲突项，由你在设置页选择保留本机 / 使用仓库 / 跳过，或让 Agent 工具带 `resolutions` 显式决定。 |
| **版本管理** | 本插件只负责「同步版本」：让本机与仓库记录的版本一致（可升可降，降级算破坏性操作需确认）。它**不会**去查最新版本、也不会替你做「升级版本」——升级请用 DSH 插件管理器/插件市场，升级后下一次备份会把新版本记进仓库，其它设备再同步时就会升级到该版本。 |
| **历史与回滚** | 从 Git 提交历史选择任意一次提交，把本机恢复到那次提交的状态（恢复前自动创建本机快照）。 |
| **自动同步** | 默认关闭。开启后在**打开客户端**、**插件变更**（安装/更新/卸载）时自动同步；**没有定时器**。自动运行遇到冲突或破坏性操作**会暂停等你处理**，不会弹窗、不会静默删除。含防抖、互斥、冷却和失败退避。 |
| **设置页** | 设置 →「插件备份」：同步状态、仓库配置、操作（主按钮「同步」「检查差异」，备份/恢复收在「更多操作」；卡片内含折叠式自动同步）、插件列表（默认折叠，展开后默认每页 10 个，可切换 5/10/20/50/100，分页在列表底部）与排除、历史记录。每 5 秒刷新状态；破坏性操作先弹预览确认。仓库配置上方有「配置页面展示」开关，控制是否在插件页显示备份标签。**仓库配置可折叠**：已配置的设备默认折叠，只显示卡片标题与「已配置」状态，点「编辑配置」展开修改；未配置/刚安装时默认展开。
**自动识别仓库类型**：根据填写的仓库地址自动识别 HTTPS / SSH / 本地路径，只展示对应的认证项——地址为空或无法识别时**不显示任何认证项**；识别为 HTTPS 后才出现「凭据助手 / Token」分段选择（只有选 Token 才显示 Token 环境变量与用户名），SSH 显示「使用系统 SSH Agent / 密钥」提示且无需填 Token，本地路径无需认证；修改地址时认证方式自动跟随。
**简洁表单**：采用设置页常见的「左侧标签 / 右侧控件」行式布局，默认只展示仓库地址与认证；分支、备份目录、设备名称、Profile 收进「高级设置」折叠区（已配置设备默认收起，未配置时默认展开），辅助说明压缩为一句话。 |
| **插件页标签** | 插件页（侧边栏「插件」）在「已安装 / 插件市场 / 发现」之后增加「备份」标签，展示同一套备份页面；可在设置页用「配置页面展示」开关显示/隐藏（默认显示，选择按浏览器记忆）。 |
| **Agent 工具** | 6 个只读/可写工具，与设置页走同一套引擎逻辑；破坏性操作两阶段确认（先预览、后执行）。 |
| **安全设计** | 不传密钥、Token、密码、私钥、Cookie；不传机器绝对路径；只同步白名单内的非敏感配置；不强制推送；恢复前快照；日志与 Git 错误统一脱敏。 |

## 3. 兼容性

| 项目 | 要求 / 实测 |
| --- | --- |
| DSH | **0.2.1-rc.3 实测可用**（`src/dsh.ts` 中的宿主 API 清单按该版本核对）。更早/更晚版本未逐一实测；插件对宿主服务全部做特性探测，缺失时降级或报「不支持」而不是崩溃。设备身份里的 DSH 版本优先读取运行中的应用包（`resources/app.asar/package.json`），读不到时回退到 Profile 中安装的 `@deepseek-ai/dsh` 包，两者都没有时记为 `unknown`。 |
| Node.js | **>= 22.19.0**（`package.json` 的 `engines`） |
| 操作系统 | macOS / Windows / Linux。路径处理区分 Windows 盘符与大小写，CI 在 Ubuntu、macOS、Windows 三种 runner 上运行。 |
| Git | **2.30 或更新**（用到 `clone --no-checkout`、`fetch <refspec>`、`reset --hard`、`show <rev>:<path>`、`remote set-url` 等常用能力）。注意：代码**不校验** Git 版本号，低于 2.30 时请自行验证；`git` 必须在 DSH 进程的 `PATH` 里。 |
| 运行时 npm 依赖 | **零**。`package.json` 只有 `devDependencies`；宿主服务通过 `ctx.get()` / `ctx.inject()` 结构式访问，不依赖任何 `@deepseek-ai/*` 运行时包。 |
| 设置页 | 需要带 Web/Desktop UI 的 Profile（提供 `connection` 的 fetch 注册能力与 `slots`）。纯 Host/CLI 组合下页面不会出现，Agent 工具仍可用。 |
| 插件管理器 | 恢复、启停、移除插件需要宿主提供 `pluginManager`；配置写回需要 `configEditor` 或可写的 `settings`。缺失时对应步骤会明确报 `unsupported`。 |

## 4. 安装

### 4.1 通过 DSH 插件管理器安装（推荐）

在 DSH 里用插件管理器安装即可（设置/插件页的安装入口，或让 Agent 调用 `plugin_manager` 工具的 `install_bundle`）。**目前尚未发布到 npm**，有两种可用的 spec：

- **直接从 GitHub 安装**（推荐，已实测 pnpm 安装成功）：
  `git+ssh://git@github.com:songni370/dsh-git-plugin-sync.git`
  （HTTPS 形式为 `https://github.com/songni370/dsh-git-plugin-sync.git`）
- npm 发布后：spec 传 `dsh-git-plugin-sync`。

仓库已提交构建产物 `lib/`（Host 半与 `lib/client.js`），因此使用 pnpm 的 DSH 插件管理器**不需要运行依赖构建脚本**即可加载；安装动作由 DSH 插件管理器完成包安装与启用，本插件自身没有安装脚本。安装后请重启 DSH（或按提示刷新页面）以加载新的浏览器包。

### 4.2 从本地开发目录安装

在仓库根目录先构建，再把本地目录交给插件管理器：

```bash
git clone https://github.com/songni370/dsh-git-plugin-sync.git
cd dsh-git-plugin-sync
npm ci
npm run build          # 生成 lib/（Host 半 + lib/client.js 浏览器半）
```

然后用 `plugin_manager` 的 `install_bundle`，spec 传**该目录的绝对路径**。本地目录安装是把工作副本链接进 Profile（不是复制），因此：

- 改完代码要重新 `npm run build`；
- 宿主需要重启或按提示刷新页面才能加载新的浏览器包；
- `files` 字段对链接目录不生效，未构建的目录会缺少 `lib/`。

### 4.3 安装后在哪里找

打开 DSH 设置窗口，选择「**插件备份**」分区（插件本身在插件清单里显示为「DSH 插件 Git 同步 / DSH Plugin Git Sync」）。页面顶部是同步状态，下面是仓库配置、操作（底部内含自动同步）、插件列表和历史记录；自动同步默认折叠，只显示「已开启/未开启 + 当前触发摘要」，点「配置」展开修改；「启动延迟」可自定义（默认 15 秒，低于 5 秒会提示冲突风险）。

**仓库配置折叠**：已经配置好仓库的设备打开页面时，「仓库配置」卡片默认折叠，只显示标题、「已配置」状态徽标与「编辑配置」按钮；点开才显示表单。没有配置（或刚安装）时默认展开完整表单。保存成功后自动按新状态折叠/展开。

**配置页面展示**：仓库配置卡片上方有「配置页面展示」开关，控制「插件」页面顶部标签行是否显示「**备份**」标签（位于「已安装 / 插件市场 / 发现」之后，内容与设置页一致）。默认显示，选择保存在浏览器本地；关闭后已打开的备份标签会被移除。

**网页端 / 客户端都可用**：宿主半（扫描、Git、Agent 工具、自动同步）与浏览器半（设置页）是同一套代码。DSH Desktop 客户端窗口和浏览器打开的 DSH 页面加载的都是 Web 客户端平台，因此设置页在两端都会出现；Agent 工具与自动同步在无 UI 的 headless `dsh` 会话中同样可用。插件按 Profile 安装：如果你还使用另一个 Profile（例如 `dsh web --profile web`），请在该 Profile 里再安装一次；每个 Profile 的插件清单会分别写入同一备份仓库的 `profiles/<profile>/` 目录，互不覆盖。

> 若设置里找不到该分区：确认当前 Profile 有 Web/Desktop UI、插件已启用、宿主提供了 `connection` 服务，并查看宿主日志里是否有「Web 设置页不可用：缺少 connection 服务」。

## 5. 快速开始：连接 GitHub 私有仓库

### 第 1 步：新建一个私有空仓库

在 GitHub 上新建 **Private** 仓库（例如 `dsh-plugins`），**不要**勾选初始化 README / .gitignore / license——本插件会自己写 `README.md`、`manifest.json` 等文件；仓库非空也能用，但空仓库最干净。然后拿到仓库地址：

- SSH：`git@github.com:<you>/dsh-plugins.git`
- HTTPS：`https://github.com/<you>/dsh-plugins.git`

> 不要把 Token 拼进 URL（比如 `https://token@github.com/...`）。插件会在保存时拒绝带用户名/密码的仓库地址。

### 第 2 步：填写仓库配置并选择认证方式

| 字段 | 说明 |
| --- | --- |
| 仓库地址 | 支持 `https://`、`ssh://`、scp 形式（`git@host:owner/repo.git`）、`file://` 或本地路径。 |
| 分支 | 备份写入/读取的分支，默认 `main`。分支不存在时首次备份会创建。 |
| 备份目录 | 备份数据在仓库内的子目录；留空 = 仓库根目录。 |
| 认证方式 | 见下。 |
| 令牌环境变量 | 仅 `https-token` 模式使用：**环境变量名**（如 `GITHUB_TOKEN`），不是令牌本身。 |
| 用户名 | 仅 `https-token` 模式使用；留空时按服务商取默认值（GitHub `x-access-token`、GitLab `oauth2`、Gitea `x-access-token`、其它 `git`）。 |
| 设备名称 | 显示在同步状态和历史记录里的设备名，默认取主机名。 |

**认证三选一**：

1. **SSH**（`ssh`）：使用系统 Git 已配置的 SSH key / ssh-agent。适合长期使用、不想碰令牌的场景。
2. **系统 Git 凭据助手**（`credential-helper`）：使用系统 Git 凭据管理器里已有的 HTTPS 凭据（macOS Keychain、Windows Credential Manager、GCM 等）。
3. **HTTPS 令牌**（`https-token`）：从**环境变量**读取访问令牌。插件只保存变量名，令牌本身永不写入配置、日志或备份仓库。Git 子进程通过临时的 `credential.helper`（`GIT_CONFIG_*` 环境配置）拿令牌，令牌不会出现在命令行参数里。

   ```bash
   # 令牌必须在 DSH 进程的环境里可见
   export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
   ```

   > 从桌面图标、launchd/systemd 等启动的 DSH **不会继承终端里的 `export`**。这种启动方式请在宿主的启动环境（或服务配置）里设置变量。保存后配置页会显示「令牌可用 / 令牌不可用」，可据此确认。

### 第 3 步：测试连接

点「测试连接」。插件会执行 `git ls-remote --heads <repo> refs/heads/<branch>`，返回：

- 成功：分支、最新提交短哈希、认证方式；
- `已连接仓库，但分支 main 尚不存在`：仓库可达，首次备份会自动建分支，属正常；
- 失败：认证失败（`git-auth-failed`）、网络错误（`git-network`）或其它 Git 错误，按提示排查。

### 第 4 步：保存

保存后配置立即生效（自动同步设置也会跟着重排）。之后就可以备份了。

## 6. 备份 / 恢复 / 同步 / 检查差异

### 6.1 备份到 Git

1. 点「更多操作」→「备份到 Git」。
2. 插件扫描本机插件 → 读仓库当前状态 → 生成计划；
3. 若计划里包含**从仓库删除记录**（例如本机删掉了某个插件，基线里还有），会先弹确认框列出破坏性步骤，确认后才执行；
4. 执行：写 `manifest.json`、`profiles/<profile>/plugins.json`、配置文件和本机快照 → 提交 → 推送；
5. 结果提示提交短哈希、「已推送」、成功步骤数和警告数。内容完全一致时不会产生空提交（`没有需要更改的内容`）。

备份**不会**删除本机插件。若某个插件本机已移除但仓库/基线里还有，备份会把它标记成「已删除」（tombstone），且这属于破坏性操作，必须确认。

### 6.2 从 Git 恢复

1. 点「更多操作」→「从 Git 恢复」；
2. 先弹预览（不执行任何操作）：将安装/升级/降级的插件、启用状态变化、要写回的配置、破坏性步骤、警告、未解决的冲突；
3. 确认后执行：**先创建本机快照**，再逐个执行安装、升级/降级、启停、写配置；
4. 单个插件失败不会中断其余步骤；有失败时结果里会逐条列出，并尝试用快照自动回滚「配置与启用状态」。

恢复的边界（重要）：

- **不会删除**备份里没有的本机插件；
- 远端已标记删除的插件只给警告，不会自动删除本机副本；
- 备份里的插件如果没有可用的安装来源（本地开发插件），会跳过并给出警告；
- 任何会改动本机的计划都要求确认（恢复的 `requiresConfirmation` 在有动作时为真）。

### 6.3 首次在第二台设备恢复（完整流程）

1. 在设备 B 安装 DSH 与本插件（见 [安装](#4-安装)）；
2. 确认设备 B 的 DSH 进程环境里有令牌变量（如果设备 A 用的是 `https-token`），或者配好 SSH key / 凭据助手；
3. 打开 设置 →「插件备份」，填入**同一个仓库地址与分支**，选认证方式，点「测试连接」；
4. 保存配置；
5. 点「更多操作」→「从 Git 恢复」→ 看预览：应该是「安装 N 个插件」等步骤；被跳过的插件会给出原因（例如「缺少可安装来源」）；
6. 确认执行，等结果；必要时按宿主提示重启 DSH（`application: restart-required` 表示已安装但需要重启才生效）；
7. 回到插件页面确认插件都在、版本正确；之后就可以开「自动同步」了。

### 6.4 同步（双向）

1. 点「同步」；
2. **没有冲突或破坏性步骤时直接执行**，不再弹窗二次确认；只有存在冲突、删除/覆盖步骤时才弹出预览（上传/下载动作、冲突、破坏性步骤）；
3. 有冲突时必须逐个选择处理方式（见 [冲突处理](#7-冲突处理)），否则执行会以 `conflict-present` 拒绝；
4. 确认后执行：先快照（如需改动本机），再本地动作，再写仓库/推送；
5. 成功后基线更新为新的共同状态，历史里多一条 `sync` 提交（有远端写入时）。

### 6.5 检查差异

「检查差异」是**只读**的：固定预览一次双向同步的计划（上传/下载/删除/冲突），只展示、不写任何东西，适合在动手前确认「对方改了什么、我会改什么」。单向操作（只上传/只下载）在「更多操作」里。

### 6.6 历史与回滚

「历史记录」列出仓库最近提交（提交、时间、操作、设备、结果、插件数），每行有「恢复」按钮：

1. 点「恢复」→ 预览该提交的恢复计划（和「更多操作」里的「从 Git 恢复」同一个预览）；
2. 确认 → 执行，把本机恢复到**那次提交时的仓库状态**；
3. 恢复前会创建本机快照。

提交信息里记录了 `Operation`（backup/restore/sync/rollback）、`Device-Id`、`Device-Name`、`Profile`、`Result`、`Plugin-Count`，所以历史能区分是哪台设备做了什么。

> **快照回滚的边界**：恢复/同步/历史回滚会自动创建本机快照（`snapshots/<id>/snapshot.json`），并在执行失败时**自动**用它回滚配置与启用状态。快照无法重装已被移除的插件；v0.1.0 设置页也没有「手动选择快照回滚」的入口（`dsh_git_plugin_history` 会返回最近的快照 ID，但没有对应的回滚工具）。

## 7. 冲突处理

同步引擎用三方比较（基线 base / 本机 local / 仓库 remote）归属改动；**双方都改**或**一方删除另一方修改**时进入冲突，绝不静默裁决。

### 冲突类型

| 类型（`reason`） | 触发场景 | 默认行为 |
| --- | --- | --- |
| `both-changed` | 基线与两侧都不同，且本机与仓库仍不一致 | 列为冲突，等待选择 |
| `local-deleted` | 本机删除了插件，而仓库里还有（或也被改过） | 列为冲突；即使允许删除也要显式选择 |
| `remote-deleted` | 仓库标记删除了插件，而本机还有（或也被改过） | 列为冲突；默认不动本机 |
| `config-conflict` | 恢复/回滚时，本机配置自基线后改过，且与仓库配置不同 | 列为冲突，等待选择 |

### 四种选择

| `choice` | 含义 | 可用位置 |
| --- | --- | --- |
| `local` | 保留本机：把本机状态推送到仓库（删除场景下就是删除远端记录，属破坏性操作） | 设置页 + HTTP + Agent 工具 |
| `remote` | 使用仓库：把仓库状态应用到本机（删除场景下就是移除本机插件，属破坏性操作） | 设置页 + HTTP + Agent 工具 |
| `skip` | 跳过：本次不处理，冲突保留（默认值） | 设置页 + HTTP + Agent 工具 |
| `manual` | 手动：用提供的 `manualConfig` 写回本机配置，并把合并后的状态推送到仓库 | 仅 HTTP API 与 Agent 工具（设置页没有该选项） |

### 规则细节

- 两侧做了**相同**改动（local == remote）不算冲突，直接收敛；
- 删除是破坏性操作：同步时本机删除远端记录、远端删除本机插件，都需要 `allowPluginRemoval = true` **且**显式选择方向；
- 自动同步遇到任何未解决冲突或破坏性计划会**暂停**并记录日志，等待你手动处理；
- 恢复（pull）方向的冲突只涉及配置（版本/启用状态会直接按仓库对齐）。

## 8. 自动同步

自动同步**默认关闭**，需要你在操作卡片底部的「自动同步」里手动开启并保存。它是**事件驱动**的，没有定时器：只在打开客户端、插件变更（安装/更新/卸载）时运行。

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| 启用自动同步 | `false` | 总开关。关闭时不会自动执行任何操作。 |
| 自动同步行为（mode） | `two-way` | `two-way` 双向同步 / `backup` 仅备份 / `restore` 仅恢复。 |
| 启动时同步 | `false` | 打开客户端后执行一次自动同步（不是只读检查）。 |
| 启动延迟（startupDelayMs） | `15000` | 打开客户端后等待多久再同步，默认 15 秒，范围 0 ~ 10 分钟；低于 5 秒时设置页会提示可能与 DSH 启动时的插件安装/刷新冲突。 |
| 插件变更后同步 | `false` | 监听宿主的 `plugin-manager/changed` 事件，防抖后触发一次自动运行。 |
| 变更触发延迟（debounceMs） | `10000` | 防抖窗口，夹在 1 秒 ~ 1 小时之间；实际生效下限 1 秒。 |
| 定时同步间隔（intervalMinutes） | `0`（已弃用） | 仅为兼容旧配置保留：调度器**不再按定时器运行**，设置页保存时写 0。 |

运行规则（`src/services/scheduler.ts`）：

- **互斥**：同一时刻只允许一个操作（引擎互斥 + 调度器本地标记），手动操作进行中会自动跳过；
- **冷却**：两次自动运行之间至少间隔 60 秒，避免「安装插件 → 触发变更 → 再安装」的死循环；
- **失败退避**：失败后按 60 秒 / 5 分钟 / 15 分钟重试，最多 3 次；仍失败则暂停自动同步并记日志；
- **退出条件**：未配置仓库、有未解决冲突（`conflict-present`）、计划含破坏性操作（`confirmation-required`）都会让自动运行暂停（`pausedReason`），不会弹窗；
- 所有定时器（启动延迟、变更防抖、失败退避）都由插件生命周期持有，关闭自动同步或卸载插件时清理。

## 9. Agent 工具

六个工具，与设置页共用同一个 `SyncEngine`，**不额外拼 shell 命令**。破坏性操作是两阶段：不带 `confirm` 只返回预览计划，带 `confirm: true` 才真正执行；引擎仍会校验计划是否已被确认。

| 工具名 | 用途 | 参数 | 并发安全 | 超时 |
| --- | --- | --- | --- | --- |
| `dsh_git_plugin_status` | 查看状态：仓库、分支、设备、上次同步时间/提交、本机与仓库插件数、待上传/待下载、冲突、最近错误 | `refresh?: boolean`（先拉取远端再算） | 是 | 120s |
| `dsh_git_plugin_backup` | 备份本机插件与配置到仓库 | `message?: string`（写进提交信息）、`confirm?: boolean` | 否 | 300s |
| `dsh_git_plugin_restore` | 从仓库恢复（可指定历史提交与插件子集） | `commit?: string`、`pluginIds?: string[]`、`resolutions?: ConflictResolution[]`、`confirm?: boolean` | 否 | 300s |
| `dsh_git_plugin_sync` | 双向同步 | `resolutions?: ConflictResolution[]`、`confirm?: boolean` | 否 | 300s |
| `dsh_git_plugin_diff` | 只读差异预览 | `direction?: 'push' \| 'pull' \| 'two-way'`（默认 `two-way`）、`commit?: string`（pull 方向比较的历史提交） | 是 | 120s |
| `dsh_git_plugin_history` | 列出仓库最近提交（时间、哈希、设备、操作、结果、插件数）与最近快照 ID | `limit?: number`（默认 20，范围 1–200） | 是 | 120s |

`resolutions` 的结构：

```json
[
  { "pluginId": "some-plugin", "choice": "local" },
  { "pluginId": "other-plugin", "choice": "manual", "manualConfig": { "timeout": 60 } }
]
```

`choice` 取 `local` / `remote` / `skip` / `manual`。两阶段语义：`confirm` 缺省或为 `false` 时，备份/恢复/同步返回预览；返回里带 `requiresConfirmation: true` 表示需要用户确认。恢复/同步的预览会包含 `plan`（动作、冲突、警告、破坏性标记）与 `source.commit`。

**中文自然语言示例**（对 Agent 说）：

- 「看一下 DSH 插件 Git 同步现在是什么状态，顺便连一下远端。」→ `dsh_git_plugin_status({ refresh: true })`
- 「把本机插件备份到 Git，提交信息写『升级主题插件前』。」→ `dsh_git_plugin_backup({ message: "升级主题插件前", confirm: true })`
- 「先看看备份和本机有哪些差异，不要改任何东西。」→ `dsh_git_plugin_diff({ direction: "push" })`
- 「从 Git 恢复插件，但先给我看会装什么、会不会删东西。」→ `dsh_git_plugin_restore()`（预览）→ 确认后 `dsh_git_plugin_restore({ confirm: true })`
- 「同步一下；如果有冲突，先列出来让我决定。」→ `dsh_git_plugin_sync()`（拿到冲突）→ `dsh_git_plugin_sync({ confirm: true, resolutions: [...] })`
- 「把本机恢复到三天前那次备份，先给我看预览。」→ `dsh_git_plugin_history({ limit: 20 })` 找到提交 → `dsh_git_plugin_restore({ commit: "<hash>" })`

## 10. 备份仓库结构与 Manifest Schema

### 10.1 仓库布局

所有路径都相对于「备份目录」（默认是仓库根目录）：

```text
<backupDir>/
├── manifest.json                        # 备份索引：schemaVersion、generator、每个 profile 的插件数与时间、设备列表
├── metadata/schema.json                 # 自描述的布局说明（schema 版本、文件说明、提交 trailer 名称）
├── README.md                            # 仓库说明与「这里不会保存什么」的警告
├── profiles/<profile>/
│   ├── plugins.json                     # 该 profile 的共享期望状态（含 tombstone 删除标记）
│   └── configs/<plugin-id>.json         # 该插件经过脱敏过滤的非敏感配置
└── devices/<deviceId>/<profile>.json    # 该设备最后一次发布的插件清单快照
```

| 文件 | 内容 | 说明 |
| --- | --- | --- |
| `manifest.json` | `{ schemaVersion, generator{name,version}, createdAt, updatedAt, profiles{<profile>:{pluginCount,updatedAt}}, devices[] }` | `createdAt` 保留仓库创建时间，`updatedAt` 每次写入更新；`generator.version` 记录**写入它的插件版本**（随每次备份更新为当前插件版本，`metadata/schema.json` 同理）；`devices` 排序后写出。 |
| `metadata/schema.json` | schema 版本、文件清单、提交 trailer 含义、安全说明 | 给不装插件的人看的自描述文档。 |
| `profiles/<profile>/plugins.json` | `{ schemaVersion, profile, updatedAt, plugins: { "<id>": entry } }` | 一个插件的共享期望状态；`deleted: true` 是删除墓碑。 |
| `profiles/<profile>/configs/<id>.json` | `{ pluginId, updatedAt, updatedBy, configs }` | 文件名由插件 ID 规范化（小写、非 `[a-z0-9._-]` 替换为 `_`）。 |
| `devices/<deviceId>/<profile>.json` | `{ schemaVersion, device, profile, updatedAt, plugins[] }` | 用于「这个插件是哪台设备、哪个平台装的」这类判断。 |

`plugins.json` 中一个条目的字段（节选）：

```json
{
  "id": "some-plugin",
  "name": "some-plugin",
  "version": "1.2.3",
  "origin": "npm",
  "installSpec": "some-plugin@1.2.3",
  "enabled": true,
  "builtIn": false,
  "syncable": true,
  "pathOnly": false,
  "rows": [{ "moduleName": "some-plugin", "enabled": true }],
  "updatedAt": "2026-10-28T07:00:00.000Z",
  "updatedBy": "dev-0123456789abcdef"
}
```

### 10.2 版本化与迁移

- 备份清单有独立的 `schemaVersion`（当前 **1**），本机状态文件 `state.json` 也有自己的版本号（当前 **1**）；
- 读取仓库时先校验版本：**比本插件支持的更新**会明确报 `invalid-manifest`：「备份仓库使用了更新的 schema 版本 vX…请升级 dsh-git-plugin-sync」，而不是猜测/静默修复；
- 结构校验失败（字段类型、时间格式、非法 ID、超过数量上限、符号链接等）同样报 `invalid-manifest`，不写入、不覆盖；
- 序列化是**确定性**的（键递归排序、两空格缩进、结尾换行），所以「数据没变」= 文件字节没变 = 不产生新提交；
- 未来的迁移策略：提升 `schemaVersion` 并在新版本插件里按旧版本读取、迁移后写新格式；旧版本插件读到新仓库会拒绝写入（上面那条升级提示）。

### 10.3 提交约定

提交主题形如 `[dsh-git-plugin-sync] backup desktop`（可选附加用户消息，最多 200 字符），提交正文是 trailer：

```text
Operation: backup
Device-Id: dev-0123456789abcdef
Device-Name: MacBook-Pro
Profile: desktop
Result: ok
Plugin-Count: 12
```

提交作者名使用设备名称，邮箱为 `<deviceId>@dsh-git-plugin-sync.local`，因此不依赖、也不读取你的全局 Git 身份配置。

## 11. 安全与隐私

### 不会上传的内容

- Token、密码、私钥、Cookie、Session Key 等任何看起来像凭据的值；
- 键名像凭据的配置项（`apiKey`、`token`、`secret`、`password`、`authorization`、`cookie`、`privateKey`、`clientSecret`……按大小写不敏感的关键词和点分路径匹配）；
- 值看起来像凭据的配置项（`-----BEGIN … PRIVATE KEY-----`、`sk-…`、`ghp_/github_pat_`、`glpat-`、`xox?-`、`AKIA…`、Bearer 头、JWT、URL 里的 `user:pass@`）；
- 机器的绝对路径：`localPath` 只在本机使用，写进仓库前被剥离；本地插件的 `source` 只保留相对/可复现形式；插件行的 `moduleName` / `entryId` 如果是绝对 `file:///…` 路径、盘符路径或含反斜杠的本地路径，**在写仓库的序列化层**会被替换为插件包名（或丢弃）——这条规则不只依赖扫描阶段，设备快照同样清洗；
- 仓库地址里的用户名/密码（保存时直接拒绝含 userinfo 的 URL）；
- 你的全局 Git 身份（提交作者由设备名与设备 ID 生成）。

### 会上传的内容

插件包名、版本、来源类型、可复现安装规格（`name@version` / git URL / tarball 相对路径）、启用状态、bundle 行、经过过滤的非敏感配置、设备名称/平台/架构/DSH 版本/插件版本、时间戳。**请把备份仓库当成「你的插件清单」来保护：建议用私有仓库。**

### 其它安全措施

- **独立工作目录**：克隆在 `<数据目录>/work/<repoUrl+branch 的哈希>`，不碰你的插件源码仓库；
- **不强制推送**：非快进推送会重新拉取、重算、重试（默认 3 次），仍失败则报 `git-push-rejected`，绝不覆盖别的设备；
- **恢复前快照**：改动本机前写 `<数据目录>/snapshots/<id>/snapshot.json`，失败时尽力自动回滚配置与启用状态；
- **危险操作需确认**：删除类操作、含破坏性的计划必须显式 `confirmDestructive` / `confirm: true`；自动同步不会替你确认；
- **Git 子进程加固**：参数数组 + `shell: false`（无 shell 注入）、禁用交互提示、超时终止、输出截断、拒绝 `-c`/`--upload-pack` 等危险选项、令牌只经环境变量传递；
- **路径安全**：备份仓库是不可信输入——绝对路径、`..`、盘符、URL scheme、NUL、`.git`、符号链接一律拒绝；
- **日志脱敏**：所有日志行与 Git 错误在写入文件/返回 UI 前统一脱敏，令牌不会落到 `sync.log`。

更完整的威胁模型与报告方式见 [docs/SECURITY.md](docs/SECURITY.md)。

## 12. 数据与本机文件位置

本插件只写自己的数据目录，不修改 DSH 的 Profile 包文件，也不把状态写进备份仓库。

| 路径 | 内容 |
| --- | --- |
| `$DSH_HOME/dsh-git-plugin-sync/config.json` | 插件配置（**不含任何密钥**，只保存令牌环境变量名） |
| `$DSH_HOME/dsh-git-plugin-sync/state.json` | 本机状态：设备身份、上次同步时间/提交、最近操作、基线、冲突、连接测试结果 |
| `$DSH_HOME/dsh-git-plugin-sync/sync.log` | JSONL 日志（已脱敏、追加写入、无自动轮转；内存环形缓冲保留最近 500 条，UI 只取最近 50 条） |
| `$DSH_HOME/dsh-git-plugin-sync/snapshots/<id>/snapshot.json` | 恢复/同步/历史回滚前的本机快照 |
| `$DSH_HOME/dsh-git-plugin-sync/work/<hash>/` | 备份仓库的克隆工作副本（纯缓存，可随时删除） |
| `$DSH_HOME/dsh-git-plugin-sync/archives/` | 预留目录（v0.1.0 尚未写入任何归档文件） |

`DSH_HOME` 未设置时按运行中的 Profile 推导（`<home>/profiles/<name>` → `<home>`），最终回退到 `~/.dsh`。文件权限为 `0600`、目录为 `0700`。

### 卸载

1. 在 DSH 插件管理器中移除本插件（`plugin_manager` 的 `remove_bundle`，或插件页的移除按钮）；
2. 可选：删除数据目录

   ```bash
   rm -rf "$DSH_HOME/dsh-git-plugin-sync"
   ```

3. **不要删除你的备份仓库**——那是你跨设备同步的数据；如果不再需要，请自行在 GitHub 上归档或删除。

移除插件不会改动你已安装的其它插件，也不会回滚任何历史同步。

## 13. 已知限制与 DSH API 限制

如实列出 v0.1.0 的边界：

| 限制 | 说明 |
| --- | --- |
| **一次只同步当前激活的 Profile** | 本机可能装有多个 DSH Profile，但引擎只扫描/写入「当前运行的这个 Profile」（`activeProfile`）。设置页会把其它 Profile 标为「暂不支持」。多 Profile 同步在路线图里。 |
| **本地开发插件默认不同步** | 通过符号链接 / 本地路径安装的插件会被识别为 `local-path`、`pathOnly: true`。默认 `includeLocalPlugins: false`，它们被跳过并给出警告；即使显式开启，也**只能把记录写进备份，无法在其它设备自动恢复**：备份里的这类条目没有可复现安装来源，恢复时会提示「缺少可安装来源，已跳过」。清单里预留了 `archive` 字段与 `backup-tarball:` 安装规格，但 v0.1.0 **没有实现归档创建**，`archives/` 目录始终为空。 |
| **插件删除默认禁止** | `allowPluginRemoval` 默认 `false`。删除类操作默认变成冲突并暂停；打开后也仍需要显式选择方向，且属于破坏性操作。 |
| **构建脚本需手动批准** | 插件安装由 DSH 插件管理器执行，若包需要运行构建脚本，管理器会返回 `pendingBuilds`，必须由**用户**在插件管理器中批准；本插件不会代批。 |
| **恢复/同步受插件管理器能力约束** | 安装用 `installBundle(spec, { saveExact: true, enabled: true })`；启用/禁用、移除分别走 `setBundleEnabled` / `setPluginEnabled` / `removeBundle`。宿主不提供插件管理器时直接报 `unsupported`；不可移除的 bundle（`removable: false`）会在结果里说明原因。 |
| **配置写回依赖宿主服务** | 优先 `configEditor.edit()`（保留当前条目其它键），否则回退 `settings.update()`；两者都没有时报 `unsupported`，配置类步骤失败。 |
| **设置页依赖 Web/Desktop Profile** | 页面需要宿主提供 `connection`（注册 HTTP 路由）与 `slots`/`locale`/`theme`；纯 Host 组合下没有设置页，Agent 工具仍可用。 |
| **不做自动合并** | 配置冲突只有四种显式选择，没有字段级自动合并；`manual` 需要自己给出完整 `manualConfig`。 |
| **快照不能重装插件** | 快照可以回滚配置与启用状态，但无法重新安装已被移除的插件（会明确报告 `notRestorablePlugins`），且 v0.1.0 没有手动快照回滚入口。 |
| **平台差异不自动判断** | 备份记录插件与设备平台，但不会替某插件判断「这个包在 Windows 上是否可用」；从 macOS 恢复的本地/原生插件到 Windows 可能不可用，需人工确认。 |
| **单仓库** | 一个配置对应一个备份仓库/分支；不支持一个设备同时同步多个仓库。 |
| **不查最新版本** | 不会读取 npm 最新版本或替你做升级；升级请用插件管理器/市场（见 [功能特性](#2-功能特性) 里的版本管理说明）。 |
| **不推送时不会「稍后自动重试」** | 并发推送冲突会立即重试（最多 3 次），失败后本次操作报错，等下次手动/自动运行。 |

## 14. 故障排查

先看 设置 →「插件备份」的「最近错误」与历史记录，再看 `$DSH_HOME/dsh-git-plugin-sync/sync.log`（已脱敏）。常见错误码：

| 现象 / 错误码 | 常见原因 | 处理 |
| --- | --- | --- |
| `git-not-found`「找不到 Git 可执行文件」 | DSH 进程的 `PATH` 里没有 `git` | 安装 Git（>= 2.30），并确保启动 DSH 的环境能看到它；GUI 启动的 DSH 可能不继承终端 `PATH`。 |
| `git-auth-failed`「Git 认证失败」 | SSH key/agent 未配置、凭据助手没有该仓库凭据、令牌环境变量缺失/失效、GitHub 已禁用密码认证 | 用「测试连接」定位；HTTPS 检查变量名拼写与 DSH 进程环境；SSH 用 `ssh -T git@github.com` 自检；令牌确认未过期且有 `repo` 权限。 |
| 「令牌不可用」 | 环境变量名保存了，但 DSH 进程里没有该变量 | 在 DSH 的启动环境里设置变量后重启 DSH；桌面端尤其注意不继承终端环境。 |
| `git-network`「Git 网络错误」/ 超时 | DNS、代理、TLS、GitHub 不可达；单条 Git 命令默认 120 秒超时 | 检查网络与代理；配置系统 Git 代理；稍后重试（该错误标记为可重试）。 |
| `git-push-rejected`「仓库正在被其他设备并发更新」 | 多台设备几乎同时写；推送被拒后重算重试仍失败 | 稍等重试；必要时先手动点「同步」。 |
| `conflict-present` | 有未解决的冲突 | 在预览里逐个选择保留本机/使用仓库/跳过，或在 Agent 工具里传 `resolutions`。 |
| `confirmation-required` | 计划包含删除/破坏性步骤 | 查看预览，确认后再次执行（设置页点「确认执行」；工具传 `confirm: true`）。 |
| `invalid-manifest` | 仓库里的 JSON 结构不合法，或 schema 版本比插件新 | 按提示升级插件；或检查是否有人手改过仓库文件（手改会被拒绝）。不要删除 `manifest.json` 试图「修复」。 |
| `invalid-config` / `invalid-path` | 仓库地址、分支名、备份目录、插件 ID 或提交哈希不合法 | 按提示改配置；提交哈希必须是 4–64 位十六进制。 |
| `not-configured` | 还没填仓库地址就操作 | 先保存仓库配置。 |
| `unsupported`「插件管理器不可用 / 无法写配置」 | 宿主没有对应服务，或不可移除的 bundle | 属于宿主能力限制；安装/移除请在插件管理器里手动完成。 |
| `install-failed` | 插件管理器安装失败（包不存在、registry 不可达、spec 无效） | 看结果里的 `application` 与消息；失败步骤不会中断其它步骤。需要构建脚本时到插件管理器里批准。 |
| `repo-empty` / 首次恢复没有内容 | 仓库还没有备份数据（新仓库/分支不存在） | 先在源设备点「更多操作」→「备份到 Git」。 |
| 状态/历史里的 DSH 版本显示 `unknown` | 运行环境里既读不到应用包（`resources/app.asar/package.json`），Profile 里也没有安装 `@deepseek-ai/dsh` | 不影响同步；设备 ID、插件版本仍可用。确认 DSH 安装方式后重启即可。 |
| 设置页没有「插件备份」 | Profile 无 Web/Desktop UI、插件未启用、宿主太旧、缺少 `connection` 服务 | 查看宿主日志中的「Web 设置页不可用」提示；升级/切换 Profile；Agent 工具可替代大部分操作。 |
| 恢复后插件在但没生效 | `application: restart-required`（宿主需要重启） | 按宿主提示重启 DSH。 |
| 远端有变更但自动同步没执行 | 自动同步已关闭、触发条件未勾选、处于冷却/暂停，或已有操作在运行 | 开启「打开客户端时同步」或「插件变更后同步」，或手动点「同步」。 |

## 15. 开发

### 15.1 目录结构

```text
src/                    # Host 半（Node）
├── index.ts            # Cordis 插件入口：装配服务、调度器、路由、工具
├── constants.ts        # 名称、schema 版本、路径常量
├── types.ts            # 领域模型
├── dsh.ts              # 宿主 API 的结构式类型（特性探测）
├── adapters/installer.ts       # 通过 DSH 插件管理器安装/启停/移除
├── scanner/inventory.ts        # 插件清单扫描
├── scanner/config-gateway.ts   # 配置读取/写回 + 脱敏
├── scanner/profiles.ts         # Profile 发现与 package.json 读取
├── services/engine.ts          # 状态/备份/恢复/同步/历史/回滚 编排（唯一业务入口）
├── services/plan.ts            # 纯函数规划：备份/恢复/双向同步 + 冲突
├── services/executor.ts        # 执行计划中的本机动作
├── services/scheduler.ts       # 自动同步调度器
├── services/snapshot.ts        # 本机快照与尽力回滚
├── services/repo-files.ts      # 内存状态 ↔ 仓库文件
├── services/model.ts           # 可比较的插件状态投影
├── git/repo-store.ts           # 克隆/读取/提交/推送/重试（唯一碰 Git 工作区的模块）
├── git/repo-paths.ts           # 仓库布局与路径安全（拒绝符号链接/.git）
├── git/git-runner.ts           # 安全 Git 子进程（无 shell、脱敏、超时）
├── manifest/manifest.ts        # 清单构建/校验/确定性序列化
├── http/api-types.ts           # Host ↔ 设置页的线上契约
├── http/routes.ts              # Web 设置页的 POST 路由
├── state/store.ts              # 本机配置/状态持久化与校验
├── tools/tools.ts              # 6 个 Agent 工具
└── core/                       # 错误、JSON、日志、互斥、路径、脱敏、版本比较
client/src/            # 浏览器半（React，由 scripts/build-client.mjs 打成 lib/client.js）
tests/unit/            # 单元测试（规划、扫描、配置网关、Git 运行器、仓库存储/序列化、清单、工具、HTTP 路由、自动同步调度、路径/脱敏/版本、持久化）
tests/integration/     # 端到端测试：两台模拟设备 + 真实本地 bare Git 仓库
tests/client/          # 设置页 jsdom 渲染冒烟测试（挂载、分区渲染、确认对话框）
docs/                  # 架构、安全、发布文档
locale/{zh,en}.json    # 插件清单里显示的标题与描述
icon.svg               # 插件图标
cordis.patch.yml       # bundle 补丁层（插入 dsh-git-plugin-sync 这一行）
```

### 15.2 常用命令

```bash
npm ci                 # 安装开发依赖
npm run typecheck      # tsc：Host（src+tests）与 Client（client/src）分别检查
npm run build          # 构建 Host（lib/*.js + .d.ts）与浏览器包（lib/client.js）
npm test               # vitest run（单元 + 集成 + jsdom 渲染冒烟测试）
npm run test:unit      # 仅单元测试
npm run test:integration   # 仅集成测试
npm run verify         # typecheck + build + test
node --check lib/client.js   # 浏览器半的语法自检（构建后）
npm pack --dry-run     # 检查实际打包文件列表（会先执行 prepack = clean + build）
```

### 15.3 本地安装验证

1. `npm run build`；
2. 用 `plugin_manager` 的 `install_bundle` 指向本仓库目录，或复制到 Profile 的 `node_modules` 后按宿主方式启用；
3. 重启 DSH（或按提示刷新页面），在 设置 →「插件备份」确认页面出现、配置能保存、「测试连接」能通过；
4. 用一个**一次性的私有测试仓库**做备份/恢复演练（推荐本地 bare 仓库：`git init --bare /tmp/backup.git`，仓库地址填 `/tmp/backup.git`）。

> 本地目录安装链接的是工作副本，`files` 字段不生效：改代码后要重新构建并重启宿主才会加载新的 Host/浏览器代码。

## 16. 发布

发布分三件事，详见 [docs/PUBLISHING.md](docs/PUBLISHING.md)。**代码已发布到 [github.com/songni370/dsh-git-plugin-sync](https://github.com/songni370/dsh-git-plugin-sync)，但尚未执行 `npm publish`**，因此 npm 安装说明以「发布之后」为前提；第一版请先从 GitHub 克隆后按 [4.2](#42-从本地开发目录安装) 从本地目录安装，或先按发布文档发布到 npm。

1. **发布到 GitHub**：创建仓库、推送 `main`、打 `v0.1.0` 标签、创建 Release；
2. **发布到 npm**：`npm publish`（`prepack` 会先 `clean` + `build`；发布前用 `npm pack --dry-run` 检查文件列表与体积）；
3. **发布到 DSH 插件市场**：插件市场（`dshmarket`）的目录来自精选列表 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)——向**那边**提 PR 添加一条插件条目；本机安装的市场 README 明确说明「本仓库是市场应用本身，不是插件目录，请勿往市场仓库提插件条目」。目录会被 CI 汇总为 `plugins.json` 并发布成 npm 包 `dsh-plugin-catalog`（`index.json` / `plugins.json`）；本机 Profile 配置的索引源就是：

   ```text
   https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json
   ```

   插件要出现在市场与插件管理器里，需要这些元数据：包名、`locale/{zh,en}.json` 里的 `meta.title` / `meta.description`、`icon.svg`（通过 `package.json` 的 `icon` 或 `exports["./icon"]` 导出）、`dsh.bundle.patch`、`dsh.client` 声明。安装市场 README 里**没有**「一键提交到市场」的命令，本机安装的 `dshmarket` 源码里也没有提交入口——唯一的收录途径就是上面的精选列表 PR。

## 17. 路线图

v0.1.0 之后计划（**均未实现**，按优先级大致排序）：

- **本地开发插件的归档与恢复**：把本地插件源码打成 tarball 存进备份仓库（`archive` 字段 + `backup-tarball:` 安装规格已经预留），让本地插件也能在其它设备恢复；
- **多 Profile 同步**：按 Profile 分别扫描/同步，而不是只处理当前激活 Profile；
- **更多认证方式**：GitHub App、系统钥匙串/凭据文件、令牌文件等；
- **手动快照回滚**：在设置页列出快照并一键回滚配置与启用状态；
- **更细的冲突处理**：字段级三方合并、按插件配置覆盖；
- **平台感知**：记录/声明插件的平台兼容性，跨平台恢复时给出更准确的警告；
- **更多语言**：补足 locale 字典与文档翻译。

## 18. 许可证

MIT，见 [LICENSE](LICENSE)。Copyright (c) 2026 dsh-git-plugin-sync contributors。
