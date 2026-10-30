# Plugin Backup

> Display name: 插件备份 / Plugin Backup · Package / repository: `dsh-plugins-git-sync` · [中文](README.md)

Back up, restore, and synchronize **DeepSeek Harness (DSH) plugins and configuration** across devices through your own **Git repository**.

[![npm](https://img.shields.io/npm/v/dsh-plugins-git-sync.svg)](https://www.npmjs.com/package/dsh-plugins-git-sync)
[![CI](https://github.com/songni370/dsh-plugins-git-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/songni370/dsh-plugins-git-sync/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

![Plugin Backup initial configuration](https://raw.githubusercontent.com/songni370/dsh-plugins-git-sync/main/docs/images/settings-config.png)

*Initial state: enter a Git repository URL to start; the device name is only an example.*

Reinstalling DSH or moving to another machine no longer means rebuilding a plugin list from memory: push the inventory to a private repository and pull it down elsewhere. The backup is plain JSON, readable and diffable with ordinary Git tools.

## What it does

- **Backup / restore**: push user-installed plugins (version, enabled state, configuration) to Git; install them back on another device.
- **Two-way sync**: upload local changes, download repository changes; when both sides changed it stops and asks.
- **Conflict handling**: keep local / use repository / skip, plus manual config merge.
- **History rollback**: restore this device to any previous commit.
- **Automatic sync**: on client startup and plugin install/update/remove; **no interval timer**.
- **Agent tools**: six tools for status, backup, restore, sync, diff and history.
- **Safety**: no tokens, passwords or private keys are read or uploaded; configs are filtered; no force pushes; a snapshot precedes local changes.

Only **user-installed third-party plugins** participate. DSH built-ins, loader internals (`cordis:*`) and this plugin itself are never backed up.

## UI

Settings → "**Plugin Backup**". The Plugins page can also show a "Backup" tab with the same content.

![Sync status and automatic sync](https://raw.githubusercontent.com/songni370/dsh-plugins-git-sync/main/docs/images/settings-status.png)

*Sync status, count tiles and the automatic-sync switch on one page; nothing runs in the background until a repository is configured.*

- **Repository card**: detects HTTPS / SSH / local paths and shows only the matching auth fields; collapsed once configured.
- **Operations**: `Sync`, `Check differences`, `Back up to Git` and `Restore from Git` are four direct buttons; nothing is hidden in a menu.
  - `Sync` runs directly when there are no conflicts or delete/overwrite steps; only those open a confirmation preview.
- **Sync status**: badge, count tiles and metadata, in the same card as the operations.
- **Automatic sync**: collapsed by default, shows on/off and trigger summary; expand to edit startup delay and triggers.
- **Plugin list**: collapsed by default; filter, pagination (10 per page by default, 5/10/20/50/100) and per-plugin sync switch.
- **History**: chronological commits with one-click restore; long subjects are ellipsised.

## Install

### From npm (recommended)

Published on npm:

```sh
dsh plugin --profile web add dsh-plugins-git-sync@latest
```

Or through the DSH plugin manager / `plugin_manager.install_bundle`:

```
dsh-plugins-git-sync
```

Update:

```sh
dsh plugin --profile web update dsh-plugins-git-sync@latest
```

### From the GitHub source (alternative)

```
git+ssh://git@github.com:songni370/dsh-plugins-git-sync.git
```

HTTPS: `https://github.com/songni370/dsh-plugins-git-sync.git`

The built `lib/` is committed, so a pnpm-based plugin manager needs no build step. Restart DSH or refresh the page after installing.

### Local development

```bash
git clone https://github.com/songni370/dsh-plugins-git-sync.git
cd dsh-plugins-git-sync
npm ci
npm run build          # lib/ (host + browser half)
```

Install with the local directory path via `plugin_manager.install_bundle`; rebuild and restart after changes.

## Quick start

1. Create a **private empty repository**.
2. Settings → "Plugin Backup", enter the URL:
   - **HTTPS**: use the Git credential helper, or "HTTPS token" and provide the *environment variable name* holding the token.
   - **SSH**: use the SSH agent / keys in `~/.ssh`; nothing else to fill in.
3. "Test connection" → save.
4. Click "Sync" to create the first backup.
5. On a second device: install the plugin, configure the same repository, save, then "Sync" (or "Restore from Git").

Each DSH profile installs and syncs separately; the repository separates them under `profiles/<profile>/`.

## How sync decides

The device keeps a **baseline** of the last agreed state and compares `base / local / remote`:

| Situation | Action |
| --- | --- |
| Only local changed | Push to repository |
| Only remote changed | Apply locally (install/upgrade/downgrade/enable/disable/restore config) |
| Neither changed | Skip |
| Both changed identically | Skip |
| Both changed differently, or delete vs. modify | Conflict; wait for your choice |

- Deleting plugins is destructive and is never automatic by default.
- A local snapshot is taken before changing this device; configuration/enabled state is rolled back on failure when possible.
- A rejected push is re-fetched, re-planned and retried; **never force-pushed**.
- No empty commits are created when nothing changed.

## Automatic sync

Off by default. Event-driven, with **no interval timer**:

- **Client startup**: configurable delay (15 seconds by default; below 5 seconds warns about racing DSH's own plugin installation).
- **Plugin changes**: install/update/remove triggers a debounced run (~10 seconds).

Automatic runs pause on conflicts or destructive plans and log the reason; no prompts and no silent deletions.

## Agent tools

Tool names remain `dsh_git_plugin_*` for compatibility with existing prompts:

| Tool | Purpose |
| --- | --- |
| `dsh_git_plugin_status` | Status, pending counts, last error |
| `dsh_git_plugin_backup` | Backup to the repository |
| `dsh_git_plugin_restore` | Restore from the repository or a commit |
| `dsh_git_plugin_sync` | Two-way sync |
| `dsh_git_plugin_diff` | Read-only difference preview |
| `dsh_git_plugin_history` | Commit history and snapshots |

Destructive operations use two-phase confirmation: preview first, then `confirm: true`.

## Safety and limits

- Never collects or uploads tokens, passwords, private keys or cookies; HTTPS stores only the env-var name.
- No absolute machine paths in backups; configs pass a whitelist filter.
- Restore does not delete local plugins that are absent from the repository.
- Syncs the active profile only; other profiles install and sync separately.
- Local-dev plugins can be recorded but cannot be installed on another device.
- It synchronizes versions/state/config; it does not check for newer versions or upgrade plugins for you.

## Data location

`$DSH_HOME/dsh-plugins-git-sync/` (config, state, log, work tree, snapshots).

After upgrading from the old name, the plugin keeps using `$DSH_HOME/dsh-git-plugin-sync/` if that exists and the new directory does not, so configuration is preserved. Uninstalling does not delete this directory.

## Development

```bash
npm ci
npm run typecheck
npm run build
npm test        # unit + integration + jsdom render tests
npm pack
```

Layout:

- `src/` — host half (scanner, Git, sync engine, HTTP routes, agent tools)
- `client/src/` — settings-page browser half
- `tests/` — unit, two-device integration against real temporary Git repos, jsdom rendering
- `docs/ARCHITECTURE.md` · `docs/SECURITY.md` · `docs/PUBLISHING.md`

## License

[MIT](LICENSE)
