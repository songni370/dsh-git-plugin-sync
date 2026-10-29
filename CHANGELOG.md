# 变更记录 / Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

暂无 / Nothing yet.

## [0.2.4] - 2026-10-29

### Added

- **自动化 Release**：推送 `v*` 标签（或在 Actions 手动指定已有标签）会自动执行构建、测试、校验版本、生成 CHANGELOG Release notes、创建 GitHub Release 并附 tarball，最后通过 npm Trusted Publishing（OIDC）发布。
- `.github/release_template.md` 与 `scripts/release-notes.mjs`。

### Changed

- 首次 npm 发布已完成，npm Trusted Publisher 已绑定到 `songni370/dsh-plugins-git-sync` + `release.yml`；本版本用于验证该发布链路并生成正式 GitHub Release。

## [0.2.3] - 2026-10-29

### Changed

- **插件页卡片图标放大到 64px**：宿主固定以 48px 渲染插件图标，插件浏览器半现在只识别「插件备份 / Plugin Backup / dsh-plugins-git-sync」对应的卡片，把该卡片的图标容器放大到 64×64（图片 60×60）；其他插件与 40px 的插件行图标保持不变。
- 该调整完全在插件侧完成，不改宿主代码；卡片高度会随之增加约 16px。

## [0.2.2] - 2026-10-29

### Changed

- **插件展示名改为「插件备份 / Plugin Backup」**（插件清单与设置导航保持一致）；插件说明文字保持不变。

## [0.2.1] - 2026-10-29

### Added

- **设计版插件图标**：
  - 插件页图标：`assets/icon.png`（鲸鱼 + 分支 + 拼图 + 双向同步，512×512、透明背景），通过 `package.json` 的 `icon` 字段与 `exports["./icon"]` 提供给 DSH，符合宿主「PNG/SVG/WebP、≤256 KiB」限制。
  - 设置页导航图标：`assets/icon-settings.png`（拼图 + 循环箭头黑色字形），内嵌为 PNG 数据 URL 用作 CSS mask，跟随浅色/深色主题的 `currentColor` 着色。
- 图标资产测试：校验插件页 PNG 签名与大小上限、设置页 mask 数据 URL 有效。

## [0.2.0] - 2026-10-29

首个面向日常使用的完整版本：插件更名为 `dsh-plugins-git-sync`，设置页、同步流程与自动同步做了整体重构。

### Added

- **设置页**：设置 →「插件备份」；同步状态、仓库配置、操作、插件列表、自动同步与历史记录整合为紧凑卡片。
- **仓库配置**：自动识别 HTTPS / SSH / 本地路径，只显示对应认证项；HTTPS 支持凭据助手或令牌环境变量；配置可折叠，已配置设备默认收起；高级设置收纳分支、备份目录、设备名称等。
- **双向同步**：基于 `base / local / remote` 三方比较；普通同步直接执行，仅冲突或删除/覆盖步骤弹出预览确认；冲突支持保留本机 / 使用仓库 / 跳过 / 手动合并。
- **操作区**：主按钮「同步」「检查差异」，备份/恢复收进「更多操作」；卡片内包含折叠的自动同步面板与同步状态，进行中的按钮显示旋转动效。
- **插件列表**：默认折叠，展开后支持筛选、分页（默认每页 10 个，可选 5/10/20/50/100）与单插件同步开关；仅列出用户安装的第三方插件。
- **自动同步**：改为纯事件触发（打开客户端 + 插件变更），无定时器；启动延迟可配置（默认 15 秒，低于 5 秒提示冲突风险）；自动运行遇到冲突或破坏性计划会暂停。
- **历史记录**：紧凑活动列表，可恢复到任意提交；回滚结果提示显示在历史卡片内。
- **Agent 工具**：6 个工具（状态、备份、恢复、同步、差异、历史），破坏性操作两阶段确认；工具名沿用 `dsh_git_plugin_*`。
- **插件页标签**：插件页可显示「备份」标签，内容与设置页一致，可在设置页开关。
- **安全与可靠性**：不传密钥与绝对路径；配置白名单过滤；恢复前快照；推送并发时重算重试且不 force push；请求 20 秒超时；提示信息 5 秒自动收起。
- **测试与 CI**：单元测试、双设备集成测试（真实临时 Git 仓库）、jsdom 渲染测试；GitHub Actions 在 macOS / Windows / Linux 运行。

### Changed

- **插件改名**：包名/仓库名由 `dsh-git-plugin-sync` 改为 `dsh-plugins-git-sync`；数据目录在升级时自动沿用旧目录，浏览器内的界面偏好会读取旧键并迁移。
- 同步状态与操作区域合并为同一个方框；状态提示统一显示在操作区域。
- 插件列表折叠时只显示标题、数量与展开按钮；刷新按钮移到筛选框右侧。
- 移除了“正在执行”等重复提示，只保留各区域的结果提示；历史摘要不再重复最近操作。
- README 重写为更简洁的上手文档，详细架构/安全/发布说明保留在 `docs/`。

### Fixed

- 修复设置页长时间“加载中”：状态轮询与并发请求不再重复 fetch/reset 仓库；打开页面不强制联网。
- 修复保存自动同步时响应多嵌套一层导致的 `Cannot read properties of undefined (reading 'repoUrl')`。
- 修复插件列表展开/收起时因 CSS `display` 覆盖 `[hidden]` 而只切换描述文字的问题。
- 修复同步预览误报 `cordis:include` 与本插件自身“已被排除”。
- 修复状态卡片本地/仓库插件数量与插件列表不一致。

## [0.1.0] - 2026-10-28

首个可用版本。

### Added

- DSH 插件扫描：读取插件包名、版本、安装来源、启用状态与经过过滤的配置；仅包含用户安装的第三方插件。
- Git 仓库备份 / 恢复 / 双向同步：可读的 JSON 清单、提交 trailer 元数据、历史回滚、冲突检测。
- 安全措施：密钥/路径脱敏、配置白名单、不 force push、恢复前快照。
- 设置页基础界面、HTTP 路由与 6 个 Agent 工具。
- 单元测试、双设备集成测试与 CI（macOS / Windows / Linux）。

[Unreleased]: https://github.com/songni370/dsh-plugins-git-sync/compare/v0.2.4...HEAD
[0.2.4]: https://github.com/songni370/dsh-plugins-git-sync/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/songni370/dsh-plugins-git-sync/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/songni370/dsh-plugins-git-sync/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/songni370/dsh-plugins-git-sync/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/songni370/dsh-plugins-git-sync/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/songni370/dsh-plugins-git-sync/releases/tag/v0.1.0
