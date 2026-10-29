# 插件备份

> 插件显示名：插件备份 / Plugin Backup · 包名 / 仓库：`dsh-plugins-git-sync` · [English](README_EN.md)

用你自己的 **Git 仓库**备份、恢复，并在多台设备之间同步 **DeepSeek Harness（DSH）插件与配置**。

[![npm](https://img.shields.io/npm/v/dsh-plugins-git-sync.svg)](https://www.npmjs.com/package/dsh-plugins-git-sync)
[![CI](https://github.com/songni370/dsh-plugins-git-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/songni370/dsh-plugins-git-sync/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

![插件备份初始配置](https://raw.githubusercontent.com/songni370/dsh-plugins-git-sync/main/docs/images/settings-config.png)

*初始状态：填写 Git 仓库地址后即可开始备份；设备名称仅作示例。*

换电脑、重装 DSH 时，不用再一个个回忆装了什么插件、什么版本、配置怎么设：把插件清单推到一个私有 Git 仓库，另一台设备同步下来即可。备份内容是普通 JSON，能用 Git 工具直接查看、对比和回滚。

## 能做什么

- **备份 / 恢复**：把本机用户安装的插件（版本、启用状态、配置）推到仓库；换设备时按仓库清单装回来。
- **双向同步**：本机改动上传、仓库改动下载；两边都改时停下来让你选择，不自动裁决。
- **冲突处理**：保留本机 / 使用仓库 / 跳过，也可以手动合并配置。
- **历史回滚**：选择任意一次提交，把本机恢复到当时的状态。
- **自动同步**：打开客户端、插件安装/更新/卸载时自动同步；**没有定时器**。
- **Agent 工具**：6 个工具，让 Agent 直接查看状态、备份、恢复、同步、检查差异、查历史。
- **安全**：不读取也不上传 Token、密码、私钥；只同步白名单配置；不强制推送；改本机前先做快照。

同步对象仅限**用户后装的第三方插件**。DSH 内置插件、加载器内部条目（`cordis:*`）和本插件自身都不会被备份。

## 界面

设置 →「**插件备份**」（英文界面为 Plugin Backup）。插件页（侧边栏「插件」）也可以显示一个「备份」标签，内容相同。

![同步状态与自动同步](https://raw.githubusercontent.com/songni370/dsh-plugins-git-sync/main/docs/images/settings-status.png)

*同步状态、数量磁贴与自动同步开关在同一页；未配置仓库时不会后台同步。*

- **仓库配置**：填 Git 地址，自动识别 HTTPS / SSH / 本地路径并显示对应认证方式；已配置的设备默认折叠。
- **操作**：`同步`、`检查差异`；`备份到 Git`、`从 Git 恢复`收在「更多操作」里。
  - 点「同步」时，**没有冲突或删除/覆盖步骤就直接执行**，不再二次确认。
  - 有冲突或破坏性步骤时才弹预览确认。
- **同步状态**：状态徽标、数量磁贴（本地/仓库/待上传/待下载/冲突）与设备、分支、提交等元数据，与操作在同一个卡片内。
- **自动同步**：默认折叠，只显示开关状态与当前触发摘要；点「配置」可改启动延迟和触发条件。
- **插件列表**：默认折叠；展开后支持筛选、分页（默认每页 10 个，可选 5/10/20/50/100）与单插件同步开关。
- **历史记录**：按时间列出提交，可一键恢复；长说明单行省略。

## 安装

### 从 npm 安装（推荐）

已发布到 npm：

```sh
dsh plugin --profile web add dsh-plugins-git-sync@latest
```

或在 DSH 插件管理器 / Agent 的 `plugin_manager.install_bundle` 中使用：

```
dsh-plugins-git-sync
```

更新：

```sh
dsh plugin --profile web update dsh-plugins-git-sync@latest
```

### 从 GitHub 源码安装（备选）

```
git+ssh://git@github.com:songni370/dsh-plugins-git-sync.git
```

HTTPS 形式：`https://github.com/songni370/dsh-plugins-git-sync.git`

仓库已提交构建产物 `lib/`，使用 pnpm 的插件管理器无需额外构建即可加载。安装后重启 DSH 或刷新页面。

### 本地开发安装

```bash
git clone https://github.com/songni370/dsh-plugins-git-sync.git
cd dsh-plugins-git-sync
npm ci
npm run build          # 生成 lib/（宿主半 + lib/client.js 浏览器半）
```

然后用 `plugin_manager` 的 `install_bundle`，spec 传该目录的绝对路径。链接目录方式下，改代码后需要重新 `npm run build` 并重启/刷新。

## 快速开始

1. 在 GitHub / GitLab 等建一个**私有空仓库**（建议不要勾选自动生成 README）。
2. 打开 设置 →「插件备份」，填仓库地址：
   - **HTTPS**：选择 Git 凭据助手，或选「HTTPS 令牌」并填写保存令牌的**环境变量名**（Token 值放在环境变量里，不写进插件配置）。
   - **SSH**：使用系统 SSH Agent / `~/.ssh` 密钥，无需额外填写。
3. 点「测试连接」→ 保存。
4. 点「同步」，第一次会生成初始备份并推送。
5. 第二台设备：安装本插件 → 填同一个仓库与认证方式 → 保存 → 点「同步」或「从 Git 恢复」。

每个 DSH Profile 需要分别安装、分别同步；仓库里按 `profiles/<profile>/` 分开存放，互不覆盖。

## 同步是怎么判断的

本机保存了一份「上次与仓库一致」的**基线（base）**，每次同步比较 `base / 本机 / 仓库` 三方：

| 情况 | 处理 |
| --- | --- |
| 只有本机变了 | 推送到仓库 |
| 只有仓库变了 | 应用到本机（安装/升级/降级/启停/恢复配置） |
| 两边都没变 | 跳过 |
| 两边都变且结果相同 | 跳过 |
| 两边都变且不同，或一边删除一边修改 | 冲突，停下来等你选择 |

- 删除插件属于破坏性操作，默认不会自动执行。
- 改本机前会创建本机快照；失败时尽量回滚配置与启停状态。
- 推送被其他设备抢先时会重新拉取、重算、重试，**不会 force push**。
- 没有需要更改的内容时不会产生空提交。

## 自动同步

默认关闭。开启后由事件触发，**不按定时器运行**：

- **打开客户端**：可配置延迟（默认 15 秒；低于 5 秒会提示可能与 DSH 启动时的插件安装冲突）。
- **插件变更**：安装 / 更新 / 卸载后，防抖约 10 秒触发一次。

自动运行遇到冲突或破坏性计划会暂停并记录日志，等待手动处理，不会弹窗、不会静默删除。

## Agent 工具

工具名沿用 `dsh_git_plugin_*`（保持对既有提示词的兼容）：

| 工具 | 作用 |
| --- | --- |
| `dsh_git_plugin_status` | 查看状态、差异数量、最近错误 |
| `dsh_git_plugin_backup` | 备份到仓库 |
| `dsh_git_plugin_restore` | 从仓库/历史提交恢复 |
| `dsh_git_plugin_sync` | 双向同步 |
| `dsh_git_plugin_diff` | 只读差异预览 |
| `dsh_git_plugin_history` | 查看历史提交与快照 |

破坏性操作需要两阶段确认：先预览，再带 `confirm: true` 执行。

## 安全与限制

- 不收集、不上传 Token、密码、私钥、Cookie；HTTPS 只保存环境变量名。
- 不写机器绝对路径；配置按白名单过滤后才写入仓库。
- 恢复默认**不删除**仓库中没有的本机插件；远端删除只给警告。
- 只同步当前客户端对应的 Profile；其他 Profile 需单独安装、单独同步。
- 本地开发插件（无 npm 安装来源）可以记录，但其他设备无法自动安装。
- 只同步版本/启停/配置，不负责查最新版本或代替插件市场升级。

## 数据位置

默认在 `$DSH_HOME/dsh-plugins-git-sync/`（配置、状态、日志、工作副本、快照）。

从旧版本升级时，如果新目录不存在而旧目录 `$DSH_HOME/dsh-git-plugin-sync/` 存在，会继续使用旧目录，不会丢配置。卸载插件时不会自动删除该目录。

## 开发

```bash
npm ci
npm run typecheck
npm run build
npm test        # 单元 + 集成 + 浏览器半渲染测试
npm pack        # 预览发布内容
```

源码结构：

- `src/`：宿主半（扫描、Git、同步引擎、HTTP 路由、Agent 工具）
- `client/src/`：设置页浏览器半
- `tests/`：单元、双设备集成（真实临时 Git 仓库）、jsdom 渲染测试
- `docs/ARCHITECTURE.md` · `docs/SECURITY.md` · `docs/PUBLISHING.md`

## 许可证

[MIT](LICENSE)
