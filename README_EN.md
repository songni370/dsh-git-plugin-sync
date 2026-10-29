# DSH Plugin Git Sync (dsh-git-plugin-sync)

**Chinese name**: DSH 插件 Git 同步　**English name**: DSH Plugin Git Sync　**Package / repository**: `dsh-git-plugin-sync`

A DeepSeek Harness (DSH) plugin that **backs up, restores, and synchronizes DSH plugin inventories and plugin configuration across devices through a Git repository**.

> ⚠️ Positioning first: this is a tool that **manages DSH plugins with Git**, not a tool that "synchronizes Git plugins", and it never touches your other Git repositories. It works only at the level of the plugin inventory: versions, enabled states, and filtered plugin configuration. Your plugin source repositories, DSH itself, and the Node runtime are out of scope.

The synchronization repository is written as a readable JSON inventory (`manifest.json` is the index), so even without this plugin you can inspect, diff, and roll back the backup with ordinary Git tooling.

- User documentation: this file · [中文](README.md)
- Maintainer documentation: [Architecture](docs/ARCHITECTURE.md) · [Security model](docs/SECURITY.md) · [Publishing](docs/PUBLISHING.md)
- Change log: [CHANGELOG.md](CHANGELOG.md)

---

## Contents

1. [Overview](#1-overview)
2. [Features](#2-features)
3. [Compatibility](#3-compatibility)
4. [Installation](#4-installation)
5. [Quick start: connect a private GitHub repository](#5-quick-start-connect-a-private-github-repository)
6. [Backup / restore / sync / diff](#6-backup--restore--sync--diff)
7. [Conflict handling](#7-conflict-handling)
8. [Automatic sync](#8-automatic-sync)
9. [Agent tools](#9-agent-tools)
10. [Backup repository layout and manifest schema](#10-backup-repository-layout-and-manifest-schema)
11. [Security and privacy](#11-security-and-privacy)
12. [Data and local file locations](#12-data-and-local-file-locations)
13. [Known limitations and DSH API constraints](#13-known-limitations-and-dsh-api-constraints)
14. [Troubleshooting](#14-troubleshooting)
15. [Development](#15-development)
16. [Publishing](#16-publishing)
17. [Roadmap](#17-roadmap)
18. [License](#18-license)

---

## 1. Overview

The more DSH plugins you install, the more painful "set up the new machine again" becomes: the plugin list, versions, enabled states, and every plugin's configuration all rely on memory and screenshots. This plugin hands that job to **a private Git repository of your own**:

- On device A, **backup** → the local plugin state is committed and pushed to your repository;
- On device B, **restore** → plugins from the inventory are installed, versions are aligned, configuration is written back;
- While both devices are in use, **sync** → a two-way merge that transfers only real changes and stops to ask about every conflict.

The backup is readable, diffable, rollback-friendly JSON. Commits carry `Operation` / `Device-Id` / `Profile` trailers, so the history shows at a glance "which device, when, did what".

### Names and identifiers

| Purpose | Value |
| --- | --- |
| Plugin display name (Chinese) | DSH 插件 Git 同步 |
| Plugin display name (English) | DSH Plugin Git Sync |
| Settings navigation label | "插件备份" / "Plugin Backup" |
| Plugins-page tab | "备份" / "Backup" |
| npm package / GitHub repository | `dsh-git-plugin-sync` |
| Backup manifest schema version | `1` |

## 2. Features

| Capability | Description |
| --- | --- |
| **Plugin scanning** | Primary source is the DSH plugin manager: package name, version, origin, reproducible install spec (`installSpec`), enabled state, bundle rows, and filtered configuration. When the plugin manager is unavailable or empty, it falls back to the profile `package.json` dependencies (degraded but useful). Built-in/official plugins are listed but never synchronized. |
| **Git repository backup / restore** | Backup writes this device's state into the repository and pushes (no empty commit when nothing changed). Restore installs, upgrades/downgrades, enables/disables plugins, and writes configuration back — it **never deletes local plugins that are absent from the backup**. |
| **Two-way sync and baselines** | A local baseline records "what this device last agreed with the repository about". A three-way comparison (base / local / remote) attributes each change, so only local changes are pushed and only remote changes are applied. |
| **Conflict handling** | When both sides changed, or one side deleted what the other modified, the plugin **never decides automatically**: it reports a conflict, and you choose keep local / use repository / skip in the settings page, or pass explicit `resolutions` through the agent tools. |
| **Version management** | This plugin only does **"sync the version"**: make the device match the version recorded in the repository (up or down; a downgrade is destructive and requires confirmation). It **does not** look up the latest version or perform a "version upgrade" for you — upgrade through the DSH plugin manager/market, and the next backup records the new version so other devices upgrade to it on their next sync. |
| **History and rollback** | Pick any commit from the repository history and restore the device to the state recorded in that commit (a local snapshot is taken first). |
| **Automatic sync** | Off by default. When enabled it syncs on **client startup** and on **plugin changes** (install/update/remove); there is **no interval timer**. Automatic runs **pause and wait** on conflicts or destructive plans: no prompts, no silent deletions. Includes debounce, mutual exclusion, cooldown, and failure backoff. |
| **Settings page** | Settings → "Plugin Backup": status, repository configuration, operations (primary "Sync" and "Check differences"; backup/restore live under "More actions"; automatic sync is folded into the card), plugin list (5 per page by default, switchable to 5/10/20/50/100 with the pager at the bottom) and exclusions, history. Status polls every 5 seconds; destructive operations always show a preview confirmation first. A "Page display" switch above the repository card controls the Plugins-page backup tab. **The repository card collapses**: a configured device shows only the card title and the "Configured" status until "Edit configuration" is clicked; a fresh install starts expanded.
**Transport detection**: the URL is detected as HTTPS, SSH or a local path and only the matching auth fields are shown — **an empty or unrecognised address shows no auth fields at all**; HTTPS then offers the credential helper or a token as a segmented control (token env var and username appear only for token auth), SSH shows the system SSH-agent/key hint and needs no token, and local paths need no credentials. Changing the URL updates the auth mode automatically.
**Concise form**: settings-style rows with the label on the left and the control on the right; only the repository address and authentication are visible by default, while branch, backup directory, device name and profile live under an "Advanced" disclosure (collapsed on a configured device, expanded on a fresh one), with one-line helper text. |
| **Plugins-page tab** | The Plugins page (sidebar "插件") gains a "备份 / Backup" tab after 已安装 / 插件市场 / 发现, showing the same backup page; the settings-page "Page display" switch shows or hides it (shown by default, remembered per browser). |
| **Agent tools** | Six read-only/read-write tools that call the same engine as the settings page. Destructive operations are two-phase (preview first, then execute). |
| **Security** | No secrets, tokens, passwords, private keys, or cookies are uploaded; no machine absolute paths; only whitelisted non-secret configuration; never force-push; snapshot before restore; logs and Git errors are redacted. |

## 3. Compatibility

| Item | Requirement / verified |
| --- | --- |
| DSH | **Verified on 0.2.1-rc.3** (the host API list in `src/dsh.ts` was checked against that version). Earlier/later versions were not tested one by one; every host service is feature-detected, so a missing service degrades or reports "unsupported" instead of crashing. The device identity reads the DSH version from the running application bundle (`resources/app.asar/package.json`) first, falls back to the `@deepseek-ai/dsh` package installed in the profile, and records `unknown` when neither is found. |
| Node.js | **>= 22.19.0** (`engines` in `package.json`) |
| Operating system | macOS / Windows / Linux. Path handling distinguishes Windows drive letters and case; CI runs on Ubuntu, macOS, and Windows runners. |
| Git | **2.30 or newer** (uses `clone --no-checkout`, `fetch <refspec>`, `reset --hard`, `show <rev>:<path>`, `remote set-url`, etc.). Note: the code **does not check** the Git version, so verify yourself if you are older; `git` must be on the DSH process's `PATH`. |
| Runtime npm dependencies | **Zero**. `package.json` only has `devDependencies`; host services are reached structurally through `ctx.get()` / `ctx.inject()` with no runtime dependency on any `@deepseek-ai/*` package. |
| Settings page | Requires a profile with a Web/Desktop UI (providing `connection` fetch registration and `slots`). In a pure host/CLI composition the page does not appear; the agent tools still work. |
| Plugin manager | Restore, enable/disable, and removal need the host's `pluginManager`; configuration write-back needs `configEditor` or a writable `settings` service. When missing, the affected steps report `unsupported` explicitly. |

## 4. Installation

### 4.1 Install through the DSH plugin manager (recommended)

Install with the DSH plugin manager (the install entry in Settings/Plugins, or let the Agent call the `plugin_manager` tool's `install_bundle`). **The package has not been published to npm yet**; two specs work:

- **Install directly from GitHub** (recommended; verified with pnpm):
  `git+ssh://git@github.com:songni370/dsh-git-plugin-sync.git`
  (HTTPS form: `https://github.com/songni370/dsh-git-plugin-sync.git`)
- After the npm release: spec `dsh-git-plugin-sync`.

The built output `lib/` (host half and `lib/client.js`) is committed, so the pnpm-based DSH plugin manager can load the plugin **without running dependency build scripts**; the plugin manager performs package installation and activation, and this plugin ships no install scripts. Restart DSH (or refresh the page as prompted) after installation to load the new browser bundle.

### 4.2 Install from a local development directory

Build in the repository root first, then hand the directory to the plugin manager:

```bash
git clone https://github.com/songni370/dsh-git-plugin-sync.git
cd dsh-git-plugin-sync
npm ci
npm run build          # produces lib/ (host half + lib/client.js browser half)
```

Then call `plugin_manager`'s `install_bundle` with the **absolute path** of that directory as the spec. Local-directory installation links the working copy into the profile (it does not copy), therefore:

- rebuild with `npm run build` after editing;
- restart DSH or refresh the page as the host instructs to load the new browser bundle;
- the `files` field does not apply to a linked directory, and an unbuilt directory lacks `lib/`.

### 4.3 Where to find it after installation

Open the DSH settings window and select the "**Plugin Backup**" section (the plugin itself is listed in the plugin inventory as "DSH 插件 Git 同步 / DSH Plugin Git Sync"). The page shows sync status at the top, followed by repository configuration, operations (automatic sync lives at the bottom of that card), the plugin list, and history; automatic sync starts collapsed and shows only an on/off status plus a schedule summary until Configure is clicked.

**Collapsible repository card**: on a device that already has a repository configured, "Repository" starts collapsed showing only the title, a "Configured" badge and an "Edit configuration" button; the form appears only after clicking it. A fresh install (or an empty URL) starts expanded. Saving a configuration collapses it again.

**Page display**: a "Page display" switch above the repository card controls whether the Plugins page's tab row shows the "**备份 / Backup**" tab (after 已安装 / 插件市场 / 发现, with the same content as the settings page). It is shown by default and remembered per browser; turning it off also removes an open backup tab.

**Usable from both the web page and the desktop client**: the host half (scanning, Git, agent tools, automatic sync) and the browser half (settings page) are one code base. The DSH Desktop client window and a DSH page opened in a browser both load the Web client platform, so the settings page appears in both; the agent tools and automatic sync also work in a headless `dsh` session with no UI. The plugin is installed per Profile: if you also use another Profile (for example `dsh web --profile web`), install it there once more; each Profile's inventory is written to its own `profiles/<profile>/` directory in the same backup repository, without overwriting the other.

> If the section is missing from Settings: confirm the current profile has a Web/Desktop UI, the plugin is enabled, and the host provides the `connection` service; check the host log for "Web 设置页不可用：缺少 connection 服务" (settings page unavailable: no connection service).

## 5. Quick start: connect a private GitHub repository

### Step 1: create a new private empty repository

Create a **Private** repository on GitHub (for example `dsh-plugins`) and **do not** initialize it with a README / .gitignore / license — this plugin writes `README.md`, `manifest.json`, and friends itself. A non-empty repository also works, but an empty one is cleanest. Then copy the repository URL:

- SSH: `git@github.com:<you>/dsh-plugins.git`
- HTTPS: `https://github.com/<you>/dsh-plugins.git`

> Never put a token in the URL (for example `https://token@github.com/...`). The plugin rejects repository URLs that carry a username/password when saving.

### Step 2: fill in the repository configuration and pick authentication

| Field | Meaning |
| --- | --- |
| Repository URL | Accepts `https://`, `ssh://`, scp-style (`git@host:owner/repo.git`), `file://`, or a local path. |
| Branch | Branch the backup is written to and read from; defaults to `main`. If the branch does not exist, the first backup creates it. |
| Backup directory | Subdirectory inside the repository that holds the backup data; empty = repository root. |
| Authentication | See below. |
| Token environment variable | `https-token` only: the **name** of an environment variable (for example `GITHUB_TOKEN`), never the token itself. |
| Username | `https-token` only; when empty, a provider default is used (GitHub `x-access-token`, GitLab `oauth2`, Gitea `x-access-token`, otherwise `git`). |
| Device name | Shown in status and history; defaults to the host name. |

**Three authentication choices**:

1. **SSH** (`ssh`): uses the SSH key / ssh-agent already configured for system Git. Best when you do not want to deal with tokens.
2. **System Git credential helper** (`credential-helper`): uses HTTPS credentials already stored in the system Git credential manager (macOS Keychain, Windows Credential Manager, GCM, ...).
3. **HTTPS token** (`https-token`): reads an access token from an **environment variable**. The plugin stores only the variable name; the token is never written to configuration, logs, or the backup repository. The Git subprocess receives it through a temporary `credential.helper` (the `GIT_CONFIG_*` environment interface), so the token never appears in command-line arguments.

   ```bash
   # The token must be visible in the DSH process environment
   export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
   ```

   > DSH launched from a desktop icon, launchd, or systemd **does not inherit `export` from your terminal**. For those launch methods, set the variable in the host's launch environment (or service configuration). After saving, the configuration card shows "token available / token unavailable" so you can confirm.

### Step 3: test the connection

Click "Test connection". The plugin runs `git ls-remote --heads <repo> refs/heads/<branch>` and reports:

- success: branch, latest commit short hash, authentication method;
- `connected, but branch main does not exist yet`: the repository is reachable and the first backup will create the branch — this is normal;
- failure: authentication failure (`git-auth-failed`), network error (`git-network`), or another Git error — follow the message.

### Step 4: save

Saving takes effect immediately (automatic-sync settings are re-applied too). You can back up from there.

## 6. Backup / restore / sync / diff

### 6.1 Back up to Git

1. Click "More actions" → "Back up to Git".
2. The plugin scans the local plugins → reads the current repository state → builds a plan.
3. If the plan contains **removals from the repository** (for example you uninstalled a plugin that still exists in the baseline), a confirmation dialog lists the destructive steps first; nothing runs until you confirm.
4. Execution: write `manifest.json`, `profiles/<profile>/plugins.json`, config files, and the device snapshot → commit → push.
5. The result shows the short commit hash, "pushed", the number of successful steps, and warnings. Identical content produces no empty commit ("Nothing to change.").

Backup **never deletes local plugins**. If a plugin was removed locally but still exists in the repository/baseline, the backup records a deletion (tombstone); that is destructive and must be confirmed.

### 6.2 Restore from Git

1. Click "More actions" → "Restore from Git".
2. A preview appears first (nothing is executed): plugins to install/upgrade/downgrade, enabled-state changes, configuration to write back, destructive steps, warnings, unresolved conflicts.
3. After confirmation: **a local snapshot is created first**, then installs, upgrades/downgrades, toggles, and configuration writes run one by one.
4. A single failing plugin does not abort the rest; failures are listed per step, and the plugin tries to roll back configuration and enabled states from the snapshot.

Restore boundaries (important):

- it **never deletes** local plugins that are absent from the backup;
- plugins tombstoned remotely only produce a warning; the local copy is kept;
- backup entries without a usable install source (local development plugins) are skipped with a warning;
- any plan that would change the device requires confirmation (`requiresConfirmation` is true when there are actions).

### 6.3 First restore on a second device (full flow)

1. Install DSH and this plugin on device B (see [Installation](#4-installation)).
2. Make sure device B's DSH process environment has the token variable (if device A used `https-token`), or has SSH keys / a credential helper configured.
3. Open Settings → "Plugin Backup", enter the **same repository URL and branch**, choose the authentication method, click "Test connection".
4. Save the configuration.
5. Click "More actions" → "Restore from Git" → review the preview: it should list "install N plugins" and similar steps; skipped plugins explain why (for example "no install source recorded").
6. Confirm and wait for the result; restart DSH if the host says so (`application: restart-required` means installed but not active until restart).
7. Verify the plugins and versions on the plugins page; then you can enable automatic sync.

### 6.4 Sync (two-way)

1. Click "Sync".
2. A preview appears: upload (push) and download (pull) actions, conflicts, destructive steps.
3. Unresolved conflicts must be decided one by one (see [Conflict handling](#7-conflict-handling)); otherwise execution is refused with `conflict-present`.
4. After confirmation: snapshot first (when the device will change), then local actions, then repository writes/pushes.
5. On success the baseline becomes the new common state, and the history gains a `sync` commit (when something was written remotely).

### 6.5 Check differences

"Check differences" is **read-only**: choose a direction (two-way / backup (upload) / restore (download)) and it only shows the plan. Useful to see "what did the other device change, what will I change" before acting.

### 6.6 History and rollback

"History" lists recent repository commits (commit, time, operation, device, result, plugin count); every row has a "Restore" button:

1. Click "Restore" → preview that commit's restore plan (the same preview as "More actions" → "Restore from Git").
2. Confirm → execute, restoring the device to **the repository state recorded in that commit**.
3. A local snapshot is created before restoring.

Commits record `Operation` (backup/restore/sync/rollback), `Device-Id`, `Device-Name`, `Profile`, `Result`, and `Plugin-Count`, so the history tells which device did what.

> **Snapshot rollback boundary**: restore/sync/history rollback create a local snapshot (`snapshots/<id>/snapshot.json`) and **automatically** use it to roll back configuration and enabled states when execution fails. Snapshots cannot reinstall removed plugins, and v0.1.0 has no "pick a snapshot and roll back" entry in the settings page (`dsh_git_plugin_history` returns recent snapshot IDs, but there is no tool to roll back from one).

## 7. Conflict handling

The sync engine attributes changes with a three-way comparison (baseline base / local / remote); when **both sides changed**, or **one side deleted what the other modified**, it reports a conflict and never decides silently.

### Conflict types

| Type (`reason`) | Trigger | Default behaviour |
| --- | --- | --- |
| `both-changed` | Base, local, and remote all differ, and local still differs from remote | Listed as a conflict, waiting for a choice |
| `local-deleted` | The plugin was deleted locally but still exists (or was also changed) remotely | Listed as a conflict; even with removal allowed, an explicit choice is required |
| `remote-deleted` | The repository tombstoned the plugin but the device still has (or also changed) it | Listed as a conflict; the local copy is kept by default |
| `config-conflict` | During restore/rollback, local configuration changed since the baseline and differs from the repository | Listed as a conflict, waiting for a choice |

### Four choices

| `choice` | Meaning | Available in |
| --- | --- | --- |
| `local` | Keep local: push the local state to the repository (in a deletion case this deletes the remote entry — destructive) | Settings page + HTTP + agent tools |
| `remote` | Use repository: apply the repository state locally (in a deletion case this removes the local plugin — destructive) | Settings page + HTTP + agent tools |
| `skip` | Skip: do not handle it now, the conflict stays (the default) | Settings page + HTTP + agent tools |
| `manual` | Manual: write the supplied `manualConfig` locally and push the merged state to the repository | HTTP API and agent tools only (no such option in the settings page) |

### Rules in detail

- Both sides making the **same** change (local == remote) is not a conflict; it converges;
- Deletions are destructive: deleting a remote entry from the device, or removing a local plugin because the remote deleted it, needs `allowPluginRemoval = true` **and** an explicit direction choice;
- Automatic sync **pauses** on any unresolved conflict or destructive plan and logs it, waiting for manual action;
- Conflicts in the restore (pull) direction involve configuration only (versions and enabled states are aligned to the repository directly).

## 8. Automatic sync

Automatic sync is **off by default**; enable it in the "Automatic sync" section at the bottom of the operations card and save. It is **event-driven**: it runs when the client starts and when plugins change (install/update/remove), with no interval timer.

| Setting | Default | Meaning |
| --- | --- | --- |
| Enable automatic sync | `false` | Master switch. Nothing runs automatically while off. |
| Behaviour (mode) | `two-way` | `two-way` sync / `backup` only / `restore` only. |
| Sync on startup | `false` | Run one automatic sync after the client opens (not a read-only check). |
| Startup delay (`startupDelayMs`) | `15000` | How long to wait after the client opens, 15 seconds by default (0 – 10 minutes); the settings page warns below 5 seconds because it may race DSH installing/refreshing plugins during boot. |
| Sync after plugin changes | `false` | Listens to the host's `plugin-manager/changed` event and triggers a debounced automatic run. |
| Change trigger delay (`debounceMs`) | `10000` | Debounce window, clamped to 1 second – 1 hour; the effective floor is 1 second. |
| Interval (`intervalMinutes`) | `0` (retired) | Kept only for old configs: the scheduler **no longer runs on a timer**, and the settings page saves 0. |

Runtime rules (`src/services/scheduler.ts`):

- **Mutual exclusion**: only one operation at a time (engine mutex + scheduler flag); automatic runs skip while a manual operation is running;
- **Cooldown**: at least 60 seconds between automatic runs, preventing an "install plugin → change event → install again" loop;
- **Failure backoff**: retries after 60 s / 5 min / 15 min, at most 3 attempts; then automatic sync pauses and logs it;
- **Exit conditions**: no repository configured, unresolved conflicts (`conflict-present`), and destructive plans (`confirmation-required`) all pause automatic runs (`pausedReason`) without prompting;
- All timers (startup delay, change debounce, failure backoff) are owned by the plugin lifecycle and cleaned up when automatic sync is disabled or the plugin is removed.

## 9. Agent tools

Six tools sharing the same `SyncEngine` as the settings page; they **never assemble shell commands**. Destructive operations are two-phase: without `confirm` they return a preview plan; with `confirm: true` they execute, and the engine still validates that the plan was acknowledged.

| Tool | Purpose | Parameters | Concurrency-safe | Timeout |
| --- | --- | --- | --- | --- |
| `dsh_git_plugin_status` | Show status: repository, branch, device, last sync time/commit, local and remote plugin counts, pending uploads/downloads, conflicts, last error | `refresh?: boolean` (fetch the remote first) | yes | 120s |
| `dsh_git_plugin_backup` | Back up local plugins and configuration to the repository | `message?: string` (stored in the commit), `confirm?: boolean` | no | 300s |
| `dsh_git_plugin_restore` | Restore from the repository (optionally from a history commit and a subset of plugins) | `commit?: string`, `pluginIds?: string[]`, `resolutions?: ConflictResolution[]`, `confirm?: boolean` | no | 300s |
| `dsh_git_plugin_sync` | Two-way sync | `resolutions?: ConflictResolution[]`, `confirm?: boolean` | no | 300s |
| `dsh_git_plugin_diff` | Read-only difference preview | `direction?: 'push' \| 'pull' \| 'two-way'` (default `two-way`), `commit?: string` (history commit for the pull direction) | yes | 120s |
| `dsh_git_plugin_history` | List recent repository commits (time, hash, device, operation, result, plugin count) and recent snapshot IDs | `limit?: number` (default 20, range 1–200) | yes | 120s |

`resolutions` shape:

```json
[
  { "pluginId": "some-plugin", "choice": "local" },
  { "pluginId": "other-plugin", "choice": "manual", "manualConfig": { "timeout": 60 } }
]
```

`choice` is one of `local` / `remote` / `skip` / `manual`. Two-phase semantics: with `confirm` absent or `false`, backup/restore/sync return a preview; `requiresConfirmation: true` in the response means the user must confirm. Restore/sync previews include `plan` (actions, conflicts, warnings, destructive flags) and `source.commit`.

**Natural-language examples** (said to an agent):

- "Show me the DSH plugin Git sync status and check the remote." → `dsh_git_plugin_status({ refresh: true })`
- "Back up my plugins to Git with the message 'before upgrading the theme plugin'." → `dsh_git_plugin_backup({ message: "before upgrading the theme plugin", confirm: true })`
- "Show me the differences between the backup and this device; don't change anything." → `dsh_git_plugin_diff({ direction: "push" })`
- "Restore plugins from Git, but show me what will be installed and whether anything gets deleted first." → `dsh_git_plugin_restore()` (preview) → then `dsh_git_plugin_restore({ confirm: true })`
- "Sync; if there are conflicts, list them and let me decide." → `dsh_git_plugin_sync()` (get conflicts) → `dsh_git_plugin_sync({ confirm: true, resolutions: [...] })`
- "Restore this device to the backup from three days ago; show a preview first." → `dsh_git_plugin_history({ limit: 20 })` to find the commit → `dsh_git_plugin_restore({ commit: "<hash>" })`

## 10. Backup repository layout and manifest schema

### 10.1 Repository layout

All paths are relative to the "backup directory" (the repository root by default):

```text
<backupDir>/
├── manifest.json                        # backup index: schemaVersion, generator, per-profile counts/times, device list
├── metadata/schema.json                 # self-describing layout (schema version, files, commit trailer names)
├── README.md                            # repository notes and a warning about what is never stored here
├── profiles/<profile>/
│   ├── plugins.json                     # shared desired state for that profile (including tombstones)
│   └── configs/<plugin-id>.json         # that plugin's filtered, non-secret configuration
└── devices/<deviceId>/<profile>.json    # last published plugin inventory of that device
```

| File | Content | Notes |
| --- | --- | --- |
| `manifest.json` | `{ schemaVersion, generator{name,version}, createdAt, updatedAt, profiles{<profile>:{pluginCount,updatedAt}}, devices[] }` | `createdAt` keeps the repository's creation time, `updatedAt` changes on every write; `generator.version` records **the plugin version that wrote it** (refreshed on every backup; `metadata/schema.json` does the same); `devices` is written sorted. |
| `metadata/schema.json` | schema version, file list, commit trailer meanings, security notes | A self-describing document for people not running the plugin. |
| `profiles/<profile>/plugins.json` | `{ schemaVersion, profile, updatedAt, plugins: { "<id>": entry } }` | One plugin's shared desired state; `deleted: true` is a deletion tombstone. |
| `profiles/<profile>/configs/<id>.json` | `{ pluginId, updatedAt, updatedBy, configs }` | The file name is derived from the plugin ID (lowercased, characters outside `[a-z0-9._-]` replaced with `_`). |
| `devices/<deviceId>/<profile>.json` | `{ schemaVersion, device, profile, updatedAt, plugins[] }` | Used for questions like "which device and platform installed this plugin". |

An entry in `plugins.json` (excerpt):

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

### 10.2 Versioning and migration

- The backup manifest has its own `schemaVersion` (currently **1**); the local state file `state.json` also carries its own version (currently **1**);
- Reading the repository validates versions first: a **newer** schema than this plugin supports fails with `invalid-manifest` ("the backup uses schema version vX … please upgrade dsh-git-plugin-sync") instead of guessing or silently repairing;
- Structural validation failures (field types, timestamp formats, invalid IDs, exceeding limits, symlinks, ...) also fail with `invalid-manifest` — nothing is written or overwritten;
- Serialization is **deterministic** (recursively sorted keys, two-space indentation, trailing newline), so "data unchanged" means "file bytes unchanged" means "no new commit";
- Migration strategy for the future: bump `schemaVersion`, have the new plugin read old versions, migrate, then write the new format; an older plugin reading a newer repository refuses to write (the upgrade message above).

### 10.3 Commit conventions

Commit subjects look like `[dsh-git-plugin-sync] backup desktop` (optionally with a user message, up to 200 characters); the commit body is trailers:

```text
Operation: backup
Device-Id: dev-0123456789abcdef
Device-Name: MacBook-Pro
Profile: desktop
Result: ok
Plugin-Count: 12
```

The commit author name is the device name and the email is `<deviceId>@dsh-git-plugin-sync.local`, so your global Git identity is never read or required.

## 11. Security and privacy

### What is never uploaded

- Tokens, passwords, private keys, cookies, session keys, and any value that looks like a credential;
- Configuration keys whose names look like credentials (`apiKey`, `token`, `secret`, `password`, `authorization`, `cookie`, `privateKey`, `clientSecret`, ... matched case-insensitively by keyword and dotted path);
- Configuration values that look like credentials (`-----BEGIN … PRIVATE KEY-----`, `sk-…`, `ghp_/github_pat_`, `glpat-`, `xox?-`, `AKIA…`, Bearer headers, JWTs, `user:pass@` in URLs);
- Machine absolute paths: `localPath` is local-only and stripped before writing; a local plugin's `source` keeps only relative/reproducible forms; a plugin row's `moduleName` / `entryId` that is an absolute `file:///…` path, a drive-letter path, or a local path containing backslashes is replaced with the plugin package name (or dropped) **at the repository serialization layer** — the rule does not rely on scanning alone, and device snapshots are sanitized the same way;
- Usernames/passwords in the repository URL (URLs with userinfo are rejected when saving);
- Your global Git identity (the commit author is derived from the device name and device ID).

### What is uploaded

Plugin package names, versions, origin kinds, reproducible install specs (`name@version` / Git URL / relative tarball path), enabled states, bundle rows, filtered non-secret configuration, device name/platform/arch/DSH version/plugin version, and timestamps. **Treat the backup repository as your plugin inventory and protect it accordingly: prefer a private repository.**

### Other security measures

- **Separate work directory**: cloned under `<data dir>/work/<hash of repoUrl+branch>`; your plugin source repositories are never touched;
- **Never force-pushes**: a non-fast-forward push re-fetches, recomputes, and retries (3 by default); a persistent failure reports `git-push-rejected` instead of overwriting another device;
- **Snapshot before restore**: before changing the device it writes `<data dir>/snapshots/<id>/snapshot.json`, and best-effort rolls back configuration and enabled states on failure;
- **Dangerous operations require confirmation**: deletions and plans with destructive steps need explicit `confirmDestructive` / `confirm: true`; automatic sync never confirms on your behalf;
- **Git subprocess hardening**: argument arrays + `shell: false` (no shell injection), interactive prompts disabled, timeout kill, output truncation, refuses dangerous options such as `-c` / `--upload-pack`, tokens passed only via environment variables;
- **Path safety**: the backup repository is untrusted input — absolute paths, `..`, drive letters, URL schemes, NUL bytes, `.git`, and symlinks are all refused;
- **Log redaction**: every log line and Git error is redacted before it is written to file or returned to the UI; tokens never reach `sync.log`.

The full threat model and reporting instructions are in [docs/SECURITY.md](docs/SECURITY.md).

## 12. Data and local file locations

The plugin writes only its own data directory; it never edits DSH profile package files and never stores state inside the backup repository.

| Path | Content |
| --- | --- |
| `$DSH_HOME/dsh-git-plugin-sync/config.json` | Plugin configuration (**no secrets**, only the token environment variable name) |
| `$DSH_HOME/dsh-git-plugin-sync/state.json` | Local state: device identity, last sync time/commit, last operation, baselines, conflicts, connection-test results |
| `$DSH_HOME/dsh-git-plugin-sync/sync.log` | JSONL log (redacted, append-only, no automatic rotation; the in-memory ring buffer keeps the last 500, the UI shows the last 50) |
| `$DSH_HOME/dsh-git-plugin-sync/snapshots/<id>/snapshot.json` | Local snapshot taken before restore/sync/history rollback |
| `$DSH_HOME/dsh-git-plugin-sync/work/<hash>/` | Working clone of the backup repository (a pure cache, safe to delete) |
| `$DSH_HOME/dsh-git-plugin-sync/archives/` | Reserved directory (v0.1.0 does not write any archive files) |

When `DSH_HOME` is unset it is derived from the running profile (`<home>/profiles/<name>` → `<home>`), finally falling back to `~/.dsh`. Files are created with `0600` permissions and directories with `0700`.

### Uninstallation

1. Remove the plugin in the DSH plugin manager (`plugin_manager`'s `remove_bundle`, or the remove button on the plugins page).
2. Optionally delete the data directory:

   ```bash
   rm -rf "$DSH_HOME/dsh-git-plugin-sync"
   ```

3. **Do not delete your backup repository** — that is your cross-device data; archive or delete it on GitHub yourself if you no longer need it.

Removing the plugin does not modify your other installed plugins and does not roll back any past synchronization.

## 13. Known limitations and DSH API constraints

Honest boundaries of v0.1.0:

| Limitation | Detail |
| --- | --- |
| **Only the active profile is synchronized** | A machine may host several DSH profiles, but the engine scans/writes only the **currently running profile** (`activeProfile`). The settings page marks other profiles as "not supported yet". Multi-profile sync is on the roadmap. |
| **Local development plugins are not synchronized by default** | Plugins installed from a symlink/local path are detected as `local-path`, `pathOnly: true`. With the default `includeLocalPlugins: false` they are skipped with a warning; even when enabled, they are **only recorded in the backup and cannot be restored automatically on another device**: such entries have no reproducible install source, and restore reports "no install source recorded; skipped". The manifest reserves an `archive` field and a `backup-tarball:` install spec, but v0.1.0 **does not implement archive creation**, so `archives/` stays empty. |
| **Plugin removal is forbidden by default** | `allowPluginRemoval` defaults to `false`. Deletion operations become conflicts and pause by default; even when enabled they still require an explicit direction choice and count as destructive. |
| **Build scripts need manual approval** | Installation is performed by the DSH plugin manager; if a package needs build scripts, the manager returns `pendingBuilds`, which **the user** must approve in the plugin manager. This plugin never approves them on your behalf. |
| **Restore/sync are constrained by the plugin manager** | Installs use `installBundle(spec, { saveExact: true, enabled: true })`; enable/disable and removal use `setBundleEnabled` / `setPluginEnabled` / `removeBundle`. Without a plugin manager the step reports `unsupported`; a non-removable bundle (`removable: false`) explains why in the result. |
| **Configuration write-back depends on host services** | Prefers `configEditor.edit()` (preserving the entry's other keys), otherwise falls back to `settings.update()`; with neither, it reports `unsupported` and configuration steps fail. |
| **The settings page needs a Web/Desktop profile** | The page needs the host's `connection` (HTTP route registration) plus `slots`/`locale`/`theme`; a pure host composition has no settings page, though the agent tools still work. |
| **No automatic merge** | Configuration conflicts have four explicit choices; there is no field-level automatic merge, and `manual` requires you to supply a complete `manualConfig`. |
| **Snapshots cannot reinstall plugins** | Snapshots roll back configuration and enabled states but cannot reinstall removed plugins (reported explicitly via `notRestorablePlugins`), and v0.1.0 has no manual snapshot-rollback entry. |
| **Platform differences are not judged** | The backup records plugin and device platforms, but it does not decide whether a package works on Windows; restoring a local/native plugin from macOS to Windows may not work and needs human review. |
| **Single repository** | One configuration maps to one backup repository/branch; a device cannot synchronize several repositories at once. |
| **No latest-version lookup** | It does not read the newest npm version or upgrade for you; upgrade through the plugin manager/market (see the version-management note in [Features](#2-features)). |
| **No deferred retry for pushes** | Concurrent push conflicts are retried immediately (up to 3 times); afterwards the operation reports an error and waits for the next manual/automatic run. |

## 14. Troubleshooting

Start with "Last error" and the history in Settings → "Plugin Backup", then inspect `$DSH_HOME/dsh-git-plugin-sync/sync.log` (already redacted). Common error codes:

| Symptom / error code | Common cause | Fix |
| --- | --- | --- |
| `git-not-found` "git executable not found" | `git` is not on the DSH process's `PATH` | Install Git (>= 2.30) and make sure the environment that launches DSH sees it; GUI-launched DSH may not inherit the terminal `PATH`. |
| `git-auth-failed` "git authentication failed" | SSH key/agent not configured, credential helper has no credentials for this repository, token env var missing/expired, password auth disabled by GitHub | Use "Test connection" to locate it; for HTTPS check the variable name and the DSH process environment; for SSH check `ssh -T git@github.com`; confirm the token is unexpired and has `repo` scope. |
| "Token unavailable" | The variable name is saved but the DSH process does not have that variable | Set the variable in DSH's launch environment and restart DSH; desktop apps notably do not inherit the terminal environment. |
| `git-network` "git network error" / timeout | DNS, proxy, TLS, GitHub unreachable; a single Git command times out after 120 seconds by default | Check network and proxy; configure a system Git proxy; retry later (this error is marked retryable). |
| `git-push-rejected` "the repository is being updated by another device" | Multiple devices writing almost simultaneously; the push was rejected and recompute+retry still failed | Retry after a moment; or run "Sync" manually first. |
| `conflict-present` | Unresolved conflicts | Choose keep local / use repository / skip in the preview, or pass `resolutions` through agent tools. |
| `confirmation-required` | The plan contains deletions/destructive steps | Review the preview and confirm again (the settings page "Run" button; `confirm: true` for tools). |
| `invalid-manifest` | Malformed JSON in the repository, or a newer schema than the plugin supports | Upgrade the plugin as instructed, or check whether someone edited repository files by hand (hand edits are rejected). Do not delete `manifest.json` to "fix" it. |
| `invalid-config` / `invalid-path` | Invalid repository URL, branch, backup directory, plugin ID, or commit hash | Fix the configuration as instructed; a commit hash must be 4–64 hex characters. |
| `not-configured` | Operating before a repository URL is saved | Save the repository configuration first. |
| `unsupported` "plugin manager unavailable / cannot write configuration" | The host lacks the service, or the bundle is not removable | A host capability limit; install/remove manually in the plugin manager. |
| `install-failed` | The plugin manager failed to install (missing package, unreachable registry, invalid spec) | Check `application` and the message in the result; a failing step does not abort the rest. When build scripts are needed, approve them in the plugin manager. |
| `repo-empty` / nothing to restore on first restore | The repository holds no backup data yet (new repository/branch) | On the source device, click "More actions" → "Back up to Git" first. |
| DSH version shows `unknown` in status/history | The runtime exposes neither the application bundle (`resources/app.asar/package.json`) nor `@deepseek-ai/dsh` in the profile | Does not affect synchronization; device ID and plugin version still work. Confirm how DSH was installed and restart. |
| No "Plugin Backup" in Settings | The profile has no Web/Desktop UI, the plugin is disabled, the host is too old, or the `connection` service is missing | Check the host log for "settings page unavailable"; upgrade/switch profile; agent tools can cover most operations. |
| Plugins restored but not active | `application: restart-required` (the host needs a restart) | Restart DSH as the host instructs. |
| Remote changes exist but auto-sync did not run | Auto-sync is off, triggers are unchecked, it is cooling down/paused, or an operation is running | Enable "Sync when the client opens" or "Sync after plugin changes", or click "Sync" manually. |

## 15. Development

### 15.1 Directory layout

```text
src/                    # host half (Node)
├── index.ts            # Cordis plugin entry: wires services, scheduler, routes, tools
├── constants.ts        # names, schema versions, path constants
├── types.ts            # domain model
├── dsh.ts              # structural host API types (feature detection)
├── adapters/installer.ts       # install/enable/remove through the DSH plugin manager
├── scanner/inventory.ts        # plugin inventory scanning
├── scanner/config-gateway.ts   # configuration read/write + redaction
├── scanner/profiles.ts         # profile discovery and package.json reading
├── services/engine.ts          # status/backup/restore/sync/history/rollback orchestration (single business entry)
├── services/plan.ts            # pure planning: backup/restore/two-way sync + conflicts
├── services/executor.ts        # executes the local half of a plan
├── services/scheduler.ts       # automatic-sync scheduler
├── services/snapshot.ts        # local snapshots and best-effort rollback
├── services/repo-files.ts      # in-memory state ↔ repository files
├── services/model.ts           # comparable plugin-state projection
├── git/repo-store.ts           # clone/read/commit/push/retry (the only module touching the Git work tree)
├── git/repo-paths.ts           # repository layout and path safety (refuses symlinks/.git)
├── git/git-runner.ts           # safe Git subprocess (no shell, redacted, timeouts)
├── manifest/manifest.ts        # manifest build/validate/deterministic serialization
├── http/api-types.ts           # host ↔ settings-page wire contract
├── http/routes.ts              # POST routes for the Web settings page
├── state/store.ts              # local configuration/state persistence and validation
├── tools/tools.ts              # the six agent tools
└── core/                       # errors, JSON, logger, mutex, paths, redaction, version compare
client/src/            # browser half (React, bundled into lib/client.js by scripts/build-client.mjs)
tests/unit/            # unit tests (planner, scanner, config gateway, git runner, repo store/serialization, manifest, tools, HTTP routes, auto-sync scheduler, paths/redaction/version, persistence)
tests/integration/     # end-to-end tests: two simulated devices + a real local bare Git repository
tests/client/          # jsdom render smoke test for the settings page (mount, sections, confirmation dialog)
docs/                  # architecture, security, publishing
locale/{zh,en}.json    # title and description shown in the plugin inventory
icon.svg               # plugin icon
cordis.patch.yml       # bundle patch layer (inserts the dsh-git-plugin-sync row)
```

### 15.2 Common commands

```bash
npm ci                 # install development dependencies
npm run typecheck      # tsc: host (src+tests) and client (client/src) checked separately
npm run build          # build host (lib/*.js + .d.ts) and browser bundle (lib/client.js)
npm test               # vitest run (unit + integration + jsdom render smoke test)
npm run test:unit      # unit tests only
npm run test:integration   # integration tests only
npm run verify         # typecheck + build + test
node --check lib/client.js   # syntax check for the browser bundle (after build)
npm pack --dry-run     # inspect the actual packed file list (runs prepack = clean + build)
```

### 15.3 Verifying a local installation

1. `npm run build`;
2. Point `plugin_manager`'s `install_bundle` at this repository directory, or copy it into the profile's `node_modules` and enable it the way the host expects;
3. Restart DSH (or refresh the page as instructed) and confirm in Settings → "Plugin Backup" that the page appears, configuration saves, and "Test connection" succeeds;
4. Rehearse backup/restore against a **throwaway private test repository** (a local bare repository is recommended: `git init --bare /tmp/backup.git`, and put `/tmp/backup.git` in the repository URL field).

> A local-directory install links the working copy, so the `files` field does not apply: rebuild and restart the host to load new host/browser code.

## 16. Publishing

Publishing is three things; see [docs/PUBLISHING.md](docs/PUBLISHING.md) for the full process. **The source is published at [github.com/songni370/dsh-git-plugin-sync](https://github.com/songni370/dsh-git-plugin-sync) but has not been `npm publish`ed yet**, so the npm instructions assume a previous publish; for the first version, clone from GitHub and install from the local directory ([4.2](#42-install-from-a-local-development-directory)), or follow the publishing guide first.

1. **Publish to GitHub**: create the repository, push `main`, tag `v0.1.0`, create a Release;
2. **Publish to npm**: `npm publish` (`prepack` runs `clean` + `build` first; inspect the file list and size with `npm pack --dry-run` before publishing);
3. **Publish to the DSH plugin market**: the market (`dshmarket`) catalog comes from the curated [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) list — open a PR **there** adding one plugin entry. The locally installed market README states explicitly that "this repository is the market app itself, not the plugin catalog; please do not PR plugin entries against the market repository". The catalog is aggregated by CI into `plugins.json` and published as the npm package `dsh-plugin-catalog` (`index.json` / `plugins.json`); the index source configured in this machine's profile is:

   ```text
   https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json
   ```

   For the plugin to appear in the market and the plugin manager, it needs these metadata items: the package name, `meta.title` / `meta.description` in `locale/{zh,en}.json`, `icon.svg` (exported via `package.json`'s `icon` or `exports["./icon"]`), `dsh.bundle.patch`, and the `dsh.client` declaration. The installed market README has **no** "submit to the market" command and the locally installed `dshmarket` sources contain no submission entry point — the only listing route is the curated-list PR above.

## 17. Roadmap

Planned after v0.1.0 (**none of it is implemented yet**, roughly in priority order):

- **Archive and restore local development plugins**: package local plugin sources as tarballs inside the backup repository (the `archive` field and the `backup-tarball:` install spec already exist) so local plugins can be restored on other devices;
- **Multi-profile sync**: scan/synchronize per profile instead of only the active one;
- **More authentication modes**: GitHub App, system keychain/credential files, token files;
- **Manual snapshot rollback**: list snapshots in the settings page and roll back configuration/enabled states with one click;
- **Finer conflict handling**: field-level three-way merge, per-plugin configuration overrides;
- **Platform awareness**: record/declare plugin platform compatibility and warn more precisely when restoring across platforms;
- **More languages**: complete locale dictionaries and document translations.

## 18. License

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 dsh-git-plugin-sync contributors.
