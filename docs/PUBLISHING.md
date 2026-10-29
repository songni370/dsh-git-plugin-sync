# 发布流程 / Publishing

本文是 **dsh-plugins-git-sync** 的发布手册：发布到 GitHub、发布到 npm、提交到 DSH 插件市场，以及版本策略。面向维护者。

This is the release manual: GitHub, npm, the DSH plugin market, and the versioning policy.

---

## 0. 发布前检查清单

- [ ] `package.json` 的 `version` 是本次要发布的版本（当前 `0.2.0`）；
- [ ] 若清单 schema 有变化，`src/constants.ts` 的 `MANIFEST_SCHEMA_VERSION` 已提升，并按 [架构文档的迁移策略](ARCHITECTURE.md#102-版本化与迁移) 处理旧数据；
- [ ] 备份仓库里的 `generator.version` 是**运行中的插件版本**：`buildManifest({ generatorVersion })` / `buildSchemaDocument(pluginVersion)` 由引擎传入 `deps.pluginVersion`，无需手动改常量；确认 `package.json` 版本正确即可；
- [ ] `CHANGELOG.md` 有本次版本的条目（日期、Added/Fixed/Security、`verified on DSH <version>`）；
- [ ] `npm run verify`（typecheck + build + test）全部通过，并且 `node --check lib/client.js` 通过；
- [ ] `npm pack --dry-run` 的文件列表符合预期（见第 2.3 节）；
- [ ] `README.md` / `README_EN.md` / `docs/*` 描述的行为与代码一致；
- [ ] 工作区干净（`git status`），没有把 `.env`、令牌、测试仓库或 `lib/` 提交进去。

> 发布是不可逆的：npm 版本一旦发布就不能覆盖（只能 `npm deprecate` 或发新版本）。多花十分钟检查，别省。

## 1. 发布到 GitHub

### 1.1 创建仓库

> **当前状态**：源码已推送到 `git@github.com:songni370/dsh-plugins-git-sync.git`（`main` 分支 + `v0.2.0` 标签），但**尚未执行 `npm publish`**。下文 GitHub 地址使用实际所有者 `songni370`，npm 安装说明以「发布之后」为前提。
>
> **注意构建产物**：本仓库**提交了 `lib/`**（Host 半、类型声明与 `lib/client.js`）。原因是 DSH 用 pnpm 安装插件，pnpm 默认阻止依赖执行构建脚本；不提交 `lib/` 时，从 Git URL 安装会缺少入口而无法加载。因此每次发版前必须 `npm run build` 并把 `lib/` 一并提交；`npm pack` 仍会通过 `prepack` 重新构建。

1. 在 GitHub 上创建仓库 `dsh-plugins-git-sync`（Public，MIT；如果暂时不公开可以先 Private，注意 `private` 会影响别人通过 npm 页面看到源码链接）。
2. **不要**勾选初始化 README / .gitignore / license（仓库里已经有了）。
3. 绑定远程并推送 `main`：

   ```bash
   git remote add origin git@github.com:songni370/dsh-plugins-git-sync.git
   git branch -M main
   git push -u origin main
   ```

   如果是 HTTPS 认证，把地址换成 `https://github.com/songni370/dsh-plugins-git-sync.git`。

4. 确认 CI 通过：`.github/workflows/ci.yml` 会在 `ubuntu-latest` / `macos-latest` / `windows-latest`、Node 22 与 24 上执行 `npm ci`、`npm run typecheck`、`npm run build`、`npm test`（单元 + 集成 + `tests/client` 渲染测试），并在 Node 24 上额外执行 `npm pack --dry-run`。

   > 说明：`npm test` 覆盖 `tests/unit`、`tests/integration` 与 `tests/client`（jsdom 渲染冒烟测试）；`npm run test:client` 可单独运行渲染测试。发布前请至少本地跑一次 `npm test`。

### 1.2 打标签并创建 Release

```bash
# 确认版本号
node -p "require('./package.json').version"       # 0.2.0

git tag -a v0.2.0 -m "dsh-plugins-git-sync 0.2.0"
git push origin v0.2.0
```

在 GitHub 的 Releases 页面基于 `v0.2.0` 创建 Release，把 `CHANGELOG.md` 对应段落粘贴为说明（或使用 GitHub CLI）：

```bash
gh release create v0.2.0 \
  --title "v0.2.0 — DSH Plugin Git Sync" \
  --notes-file <(sed -n '/## \[0.2.0\]/,/## \[/p' CHANGELOG.md)
```

Release 里可以附上 `npm pack` 产物 `dsh-plugins-git-sync-0.2.0.tgz`（可选；npm 上已经有 tarball 时通常不必）。

### 1.3 发布后

- 在 README 顶部补上 GitHub 链接（仓库地址确定后）；
- `CHANGELOG.md` 底部的 `[0.2.0]` 比较链接已指向 `songni370/dsh-plugins-git-sync`；
- 打开 Issues / Discussions / Security Advisories（漏洞报告用，见 [SECURITY.md](SECURITY.md#9-漏洞报告--reporting-a-vulnerability)）。

## 2. 发布到 npm

> 当前这个仓库**还没有执行过 `npm publish`**；下面是一次完整首次发布的步骤。

### 2.1 账户与权限

```bash
npm login
npm whoami
```

- 需要该包名（`dsh-plugins-git-sync`）的发布权限；若名字已被占用，需要换包名**或**联系持有者，不要抢注相近名字。
- 发布前确认名称可用（返回 404 = 未发布；返回 JSON = 已存在）：

  ```bash
  npm view dsh-plugins-git-sync version
  ```

- 建议开启 2FA；`npm publish` 会要求 OTP。

### 2.2 prepack 做了什么

`package.json` 的 `prepack` 脚本是 `npm run clean && npm run build`：

1. `clean`：删除 `lib/`；
2. `build:host`：`tsc -p tsconfig.build.json`，从 `src/` 产出 `lib/*.js` + `lib/**/*.d.ts`；
3. `build:client`：`node scripts/build-client.mjs`，用 esbuild 把 `client/src/index.tsx` 打成 `lib/client.js`（CommonJS，React 外置，包在 `window.__ModuleLoader__.load({id, factory(require){...}})` 里）。

打包文件由 `files` 字段决定：`lib`、`locale`、`cordis.patch.yml`、`icon.svg`、`README.md`、`README_EN.md`、`CHANGELOG.md`、`LICENSE`（npm 还会自动带上 `package.json`）。`src/`、`client/`、`tests/`、`docs/` **不会**进 tarball。

### 2.3 检查 tarball

```bash
npm pack --dry-run
# 或先产出真实 tarball 检查内容
npm pack
tar -tzf dsh-plugins-git-sync-0.2.0.tgz | sort
```

必须确认：

- `lib/index.js`、`lib/client.js`、`lib/index.d.ts` 存在；
- `cordis.patch.yml`、`icon.svg`、`locale/zh.json`、`locale/en.json` 存在；
- `README.md` / `README_EN.md` / `CHANGELOG.md` / `LICENSE` 存在；
- 没有 `src/`、`tests/`、`node_modules/`、`.git/`、临时文件、`*.tgz` 自己；
- `package.json` 的 `main`（`lib/index.js`）、`types`（`lib/index.d.ts`）、`exports` 指向的文件都确实在包里。

> 本次文档编写时实际运行 `npm pack --dry-run` 的结果（供对照）：**72 个文件，tarball 184.2 kB，解包后 706.9 kB**；其中 `lib/client.js` 约 122 kB，`README.md` + `README_EN.md` + `CHANGELOG.md` 三个文档就占了约 98 kB。文件数/体积会随代码与文档变化，请以你自己的运行为准。

### 2.4 发布

```bash
npm publish --access public
```

- 包名不带 scope，默认可发布；`--access public` 是显式声明（无 scope 时可选）。
- 发布后验证：

  ```bash
  npm view dsh-plugins-git-sync version dist.tarball
  npm pack dsh-plugins-git-sync@0.2.0 --dry-run   # 看已发布版本的文件列表
  node --check lib/client.js                     # 浏览器半的语法自检
  ```

- 在干净目录里装一次验证宿主能否加载：

  ```bash
  mkdir -p /tmp/dsh-git-sync-check && cd /tmp/dsh-git-sync-check
  npm init -y
  npm i dsh-plugins-git-sync@0.2.0
  node -e "import('dsh-plugins-git-sync').then(m => console.log(m.name, typeof m.apply))"
  ```

- 然后在本机 DSH 里用插件管理器安装 `dsh-plugins-git-sync`（`plugin_manager` 的 `install_bundle`），确认插件清单里出现标题/描述/图标，设置页出现「插件备份」分区并能测试连接。**只有观察到这两点，才算安装验证通过。**

### 2.5 发错了怎么办

- **不要** `npm unpublish`（已发布版本通常无法撤销，且会让依赖者断掉；npm 对未满 72 小时/无依赖的版本才可能允许删除）；
- 用 `npm deprecate dsh-plugins-git-sync@0.2.0 "reason"` 标记，再发布修正版本（`0.2.1`）；
- 如果只是文档错误，发 patch 版本。

## 3. 提交到 DSH 插件市场

### 3.1 市场是怎么收录插件的（基于本机安装的 dshmarket 1.71.1）

本机安装的市场包路径：`<profile>/node_modules/dshmarket`（本机为 `~/.dsh/profiles/desktop/node_modules/dshmarket`）。它的中文 README（`README.zh.md`）在「提交你的插件」一节写得很明确：

> **这个仓库是市场应用本身，不是插件目录。** 市场里的插件列表来自精选列表 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)——想让你的插件上架，请去**那边**提 PR（在列表里加一条即可，站点和本市场会自动收录，通常一天内生效）。请不要往本仓库提插件条目。

同一份 README 还说明：市场每次打开都会实时请求 `https://awesome-dsh-plugin.com/plugins.json`（精选条目、npm 映射、star 数由 CI 每日刷新），并把同一份目录发布成 npm 包 `dsh-plugin-catalog`（`index.json` / `plugins.json`），因此中国大陆也能从 npm 镜像拿到目录。

本机 Profile（`~/.dsh/profiles/desktop/cordis.patch.yml`）里配置的索引源正是：

```yaml
- id: plugin-market
  name: "@deepseek-ai/dsh-plugin-market"
  config:
    indexes:
      - https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json
```

`dshmarket` 的源码也印证了这条链路：`src/regions.ts` 里官方目录是 `https://awesome-dsh-plugin.com/plugins.json`，npm 包名是 `dsh-plugin-catalog`；`src/catalog-npm.ts` 读取该包 tarball 里的 `plugins.json`；`src/registry.ts` 校验目录条目。**在已安装的 `dshmarket` 源码中没有找到任何「提交插件」的命令、HTTP 接口或界面入口**——收录机制只有精选列表的 PR。

### 3.2 可执行步骤

1. **先完成 npm 发布**（第 2 节）。市场安装的是 npm 包；目录条目通过 npm 包名映射到可安装目标，npm 上没有的版本装不上。
2. 打开精选列表仓库 `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`，阅读它的贡献说明 / 条目模板（**以该仓库的 `CONTRIBUTING`/README 为准**；本文不复制一个可能过期的模板）。
3. Fork 该仓库，在插件列表中添加**一条**条目，包含：
   - 插件名称：`dsh-plugins-git-sync`；
   - 仓库 URL：`https://github.com/songni370/dsh-plugins-git-sync`；
   - npm 包名：`dsh-plugins-git-sync`；
   - 分类（category）：建议 `git`（Git & Code Review）或按列表分类里的实际 id 选择；
   - 中英文描述（`description` 支持按语言提供，见 3.3）；
   - 图标（若该列表的条目模板支持 `icon` 字段）：指向一个稳定的、可公开访问的图片 URL。
4. 提交 PR，说明这是一个「用 Git 备份/恢复/多设备同步 DSH 插件与配置」的插件，附上 npm 链接与 README。
5. 等待 CI 合并；合并后目录通常一天内更新：`awesome-dsh-plugin.com` 的站点、`plugins.json`、`dsh-plugin-catalog` npm 包、以及本机市场（实时拉取）。
6. 在本机验证收录：打开市场的「发现 / Discover」页搜索 `dsh-plugins-git-sync`，或在插件市场的索引源配置里刷新（见 3.4）；确认卡片标题、描述、图标、版本、安装按钮正常。

> 本机没有安装 `awesome-dsh-plugin` 仓库，**未能核对条目模板的确切字段**；如果该仓库提供了字段说明，以它为准。下面 3.3 列出的是**市场侧实际读取**的字段，可作为自检依据。

### 3.3 市场 / 插件管理器需要的元数据

市场侧（`dshmarket` 1.71.1 `src/registry.ts` 的 `RegistryPlugin`）会读取/校验：`name`、`owner`、`url`、`category`、`description`（按语言）、`npm`、`tarball`（可选，仓库自有 Release 的 `.tgz`）、`stars`、`downloads`、`version`、`icon`（可选，缺省回退到仓库所有者的 GitHub 头像）、`deprecated` / `replacement` / `previousNpm` / `capabilities` 等可选字段。目录的顶层格式是 `format: 1`，包含 `title` / `description`（多语言）、`metadata.categories`、`plugins[]`（每项含 `name`、`title`、`description{zh,en}`、`homepage`、`repository.url`、`metadata.category/keywords/labels/sortKeys`、`versions[{version, publishTimestamp, source{type}, engines}]`）。

宿主/插件管理器侧（`cordis-plugin-development` 参考文档与 `package.json` 约定）读取：

| 元数据 | 本仓库位置 | 说明 |
| --- | --- | --- |
| 插件标题与描述 | `locale/zh.json`、`locale/en.json` 的 `meta.title` / `meta.description` | 插件清单与设置里显示；`package.json` 的 `dsh`/`exports` 需要导出 `./locale/*.json`（当前已导出） |
| 图标 | `icon.svg`；`package.json` 的 `icon` 字段与 `exports["./icon"]` | 支持 SVG/PNG/JPEG/WebP，≤256 KiB；必须位于包内，绝对路径/URL/包外符号链接会被拒绝 |
| bundle 补丁 | `cordis.patch.yml` | `dsh.bundle.patch` 指向它；缺失则插件不会被装入 profile |
| 浏览器半声明 | `package.json` 的 `dsh.client`（`platform: web` + `inject`） | 设置页注册所需 |
| 宿主版本要求 | （可选）`package.json` 的 `engines.dsh` 或同版本线 `@deepseek-ai/dsh-*` peer 依赖 | 市场卡片会展示声明的宿主要求；当前包**只声明了 `engines.node`**，没有声明 `engines.dsh`——发布时可考虑补上，以便市场做兼容筛选 |
| 包名 / 版本 | `package.json` 的 `name` / `version` | 目录条目与安装目标都按包名映射 |

### 3.4 索引源（Index sources）与本地验证

DSH 0.2.1 起，市场说明里给出的入口是：**插件 → 发现（Discover）→ 索引源（Index sources）**，添加上面 3.1 的目录索引 URL（`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`）。等价的 profile 配置方式（本机已在用）就是上面 `cordis.patch.yml` 里的 `plugin-market` 的 `config.indexes`。宿主给索引源的超时约 15 秒，npm CDN 通常比 GitHub Pages 快。

## 4. 版本策略

遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)：

| 变化 | 版本位 | 例子 |
| --- | --- | --- |
| 修 bug、文档、兼容性修补，不改变备份格式与行为契约 | patch `0.2.x` | 修复某类 Git 错误分类、修正文案 |
| 新增向后兼容能力（新工具、新动作、新认证方式、新 UI 元素） | minor `0.x.0`（1.0 前） | 实现本地插件归档恢复、多 Profile 同步 |
| 破坏性变化（备份 schema 升版且不兼容、配置字段语义变化、删除 API/工具、行为契约改变） | 1.0 前用 minor，1.0 后用 major | 清单 `schemaVersion` 2、`resolutions` 结构变化 |
| 备份格式或本机状态格式变化 | 必须同时提升对应的 `schemaVersion`，并给出读取旧版本 → 迁移的路径 | `MANIFEST_SCHEMA_VERSION` / `STATE_SCHEMA_VERSION` |

约定：

- **git tag 与 npm 版本一致**（`v0.2.0` ↔ `0.2.0`），并在 Release 说明里引用 CHANGELOG；
- 每个发布都更新 `CHANGELOG.md`（新增条目，不覆盖历史），末尾补比较链接；
- 发布前跑 `npm run verify`；发布后按第 2.4 节验证 npm 产物与宿主安装；
- 目录/市场收录的是 npm 包：**先发 npm，再提市场更新**；市场通常会在一天内自动同步版本；
- 备份仓库里 `manifest.json` / `metadata/schema.json` 的 `generator.version` 记录运行中的插件版本（自动），不需要手工维护；
- 有安全问题的版本：修复后发 patch，并在 CHANGELOG 的 Security 段落说明（修复可用之后），必要时 `npm deprecate` 旧版本。

## 5. 发布后回归检查

1. 在一台**干净**的设备（或新的 DSH Profile）上通过插件管理器安装 `dsh-plugins-git-sync`；
2. 设置里出现「插件备份」，标题/描述/图标正确（中英文都检查）；
3. 用一个**新的私有空仓库**跑完整流程：测试连接 → 备份 → 在第二个 Profile/设备恢复 → 同步 → 历史回滚；
4. 确认仓库里没有秘密与绝对路径（`git log -p` 抽查，或按 [SECURITY.md](SECURITY.md#7-永远不会上传的内容) 的清单检查）；
5. 确认市场/索引源能搜到并安装该版本（若已收录）。
