/**
 * Repository transport detection: the configuration form shows only the auth
 * fields that fit the URL the user typed.
 */

import { describe, expect, it } from 'vitest'
import { authForTransport, detectRepoTransport, transportUsesAuth } from '../../client/src/repo-transport.js'

describe('detectRepoTransport', () => {
  it('recognises HTTPS URLs', () => {
    expect(detectRepoTransport('https://github.com/songni370/dsh-git-plugin-sync.git')).toBe('https')
    expect(detectRepoTransport('http://git.internal/repo.git')).toBe('https')
    expect(detectRepoTransport('  https://github.com/a/b  ')).toBe('https')
  })

  it('recognises SSH URLs and scp-like syntax', () => {
    expect(detectRepoTransport('git@github.com:songni370/dsh-git-plugin-sync.git')).toBe('ssh')
    expect(detectRepoTransport('ssh://git@example.com:2222/repo.git')).toBe('ssh')
    expect(detectRepoTransport('sftp://git@example.com/repo.git')).toBe('ssh')
    expect(detectRepoTransport('gitlab.example.com:group/repo.git')).toBe('other')
  })

  it('recognises local repositories', () => {
    expect(detectRepoTransport('file:///tmp/backup.git')).toBe('local')
    expect(detectRepoTransport('/tmp/backup.git')).toBe('local')
    expect(detectRepoTransport('~/backups/dsh.git')).toBe('local')
    expect(detectRepoTransport('./backup.git')).toBe('local')
    expect(detectRepoTransport('C:\\repos\\backup.git')).toBe('local')
  })

  it('reports none/other for empty or unknown forms', () => {
    expect(detectRepoTransport('')).toBe('none')
    expect(detectRepoTransport('   ')).toBe('none')
    expect(detectRepoTransport('--upload-pack=evil')).toBe('other')
    expect(detectRepoTransport('git://example.com/repo.git')).toBe('other')
  })
})

describe('authForTransport', () => {
  it('forces SSH auth for SSH URLs', () => {
    expect(authForTransport('ssh', 'https-token')).toBe('ssh')
    expect(authForTransport('ssh', 'credential-helper')).toBe('ssh')
  })

  it('keeps an HTTPS token choice and otherwise falls back to the helper', () => {
    expect(authForTransport('https', 'https-token')).toBe('https-token')
    expect(authForTransport('https', 'ssh')).toBe('credential-helper')
    expect(authForTransport('https', 'credential-helper')).toBe('credential-helper')
  })

  it('leaves local/other/none modes alone', () => {
    expect(authForTransport('local', 'ssh')).toBe('ssh')
    expect(authForTransport('other', 'https-token')).toBe('https-token')
    expect(authForTransport('none', 'credential-helper')).toBe('credential-helper')
  })

  it('only offers an auth choice for network transports that need one', () => {
    expect(transportUsesAuth('https')).toBe(true)
    expect(transportUsesAuth('other')).toBe(true)
    expect(transportUsesAuth('none')).toBe(true)
    expect(transportUsesAuth('ssh')).toBe(false)
    expect(transportUsesAuth('local')).toBe(false)
  })
})
