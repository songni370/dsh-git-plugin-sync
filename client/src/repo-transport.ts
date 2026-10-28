/**
 * Repository transport detection for the configuration form.
 *
 * The same Git URL can be reached over HTTPS (token or credential helper) or
 * SSH (agent/keys); asking a user to pick an authentication mode that does not
 * match the URL is the most common setup mistake. The form detects the
 * transport from the URL and shows only the fields that apply.
 * @module repo-transport
 */

import type { GitAuthMode } from '../../src/types'

/** How the configured repository is reached. */
export type RepoTransport = 'https' | 'ssh' | 'local' | 'other' | 'none'

/**
 * Detect the transport of a repository URL.
 *
 * - `https` / `http` → HTTPS transport (credential helper or token)
 * - `ssh://`, `sftp://` and scp-like `git@host:path` → SSH
 * - `file://`, absolute paths, `~/…`, `./…` → local repository (no auth)
 * - anything else non-empty, or empty → `other` / `none`
 */
export function detectRepoTransport(input: string): RepoTransport {
  const value = input.trim()
  if (value === '') return 'none'
  if (/^file:/i.test(value)) return 'local'
  if (/^[A-Za-z]:[\\/]/.test(value)) return 'local'
  if (value.startsWith('/') || value.startsWith('\\\\') || value.startsWith('~')) return 'local'
  if (value.startsWith('./') || value.startsWith('../')) return 'local'
  if (/^https?:\/\//i.test(value)) return 'https'
  if (/^ssh:\/\//i.test(value) || /^sftp:\/\//i.test(value)) return 'ssh'
  // scp-like syntax: git@github.com:owner/repo.git
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/.test(value)) return 'ssh'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return 'other'
  return 'other'
}

/**
 * Pick the authentication mode that fits the transport, keeping an explicit
 * choice when it is still valid (for HTTPS, a token choice survives URL edits).
 */
export function authForTransport(transport: RepoTransport, current: GitAuthMode): GitAuthMode {
  if (transport === 'ssh') return 'ssh'
  if (transport === 'https') return current === 'https-token' ? 'https-token' : 'credential-helper'
  return current
}

/** Whether the transport needs an authentication choice in the form. */
export function transportUsesAuth(transport: RepoTransport): boolean {
  return transport === 'https' || transport === 'other' || transport === 'none'
}
