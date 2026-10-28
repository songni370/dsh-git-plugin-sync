/**
 * "Repository" card: where the backup lives, how to authenticate, and the
 * two explicit actions that make the form meaningful (test, save).
 *
 * The token is NEVER a field here. The Host stores the environment variable
 * NAME and reports whether that variable currently holds a value; the page
 * shows the name plus availability and has no way to read or write the secret.
 * @module ui/ConfigSection
 */

import type { ReactElement } from 'react'
import type { ConnectionTestResult, GitAuthMode, SyncConfigView } from '../../../src/types'
import type { Translate } from '../i18n'
import { formatDateTime, shortCommit } from '../format'
import {
  authForTransport,
  detectRepoTransport,
  transportUsesAuth,
  type RepoTransport,
} from '../repo-transport'
import { Badge, Banner, Button, Card, Field, Select, TextInput } from './controls'

/** The editable subset of the Host configuration. */
export interface ConfigForm {
  repoUrl: string
  branch: string
  backupDir: string
  authMode: GitAuthMode
  tokenEnvVar: string
  username: string
  deviceName: string
}

/** Build the form from the Host's effective configuration view. */
export function configFormFromView(view: SyncConfigView): ConfigForm {
  return {
    repoUrl: view.repoUrl,
    branch: view.branch,
    backupDir: view.backupDir,
    // A legacy HTTPS URL saved with SSH auth (or the reverse) must not render
    // an auth selector with no matching option; show the mode that fits.
    authMode: authForTransport(detectRepoTransport(view.repoUrl), view.authMode),
    tokenEnvVar: view.tokenEnvVar,
    username: view.username,
    deviceName: view.deviceName,
  }
}

const AUTH_HINT: Record<GitAuthMode, string> = {
  'credential-helper': 'configAuthCredentialHelperHint',
  ssh: 'configAuthSshHint',
  'https-token': 'configAuthHttpsTokenHint',
}

/** Props for {@link ConfigSection}. */
export interface ConfigSectionProps {
  t: Translate
  form: ConfigForm
  /** Effective Host view, for token availability and profile names. */
  view: SyncConfigView
  /** The user changed a field since the last save. */
  dirty: boolean
  saving: boolean
  testing: boolean
  /** Result of the last test from this card. */
  connection: ConnectionTestResult | null
  onChange: (patch: Partial<ConfigForm>) => void
  onTest: () => void
  onSave: () => void
  /** Whether the form body is expanded. */
  open: boolean
  /** Expand/collapse the card body. */
  onToggle: () => void
}


/** Label + hint for one detected transport. */
function transportMeta(t: Translate, transport: RepoTransport): { label: string; hint: string } {
  switch (transport) {
    case 'https':
      return { label: t('configDetectedHttps'), hint: t('configTransportHttpsHint') }
    case 'ssh':
      return { label: t('configDetectedSsh'), hint: t('configTransportSshHint') }
    case 'local':
      return { label: t('configDetectedLocal'), hint: t('configTransportLocalHint') }
    case 'other':
      return { label: t('configDetectedOther'), hint: t('configTransportOtherHint') }
    case 'none':
      return { label: '', hint: '' }
  }
}

/** Render the repository-configuration card. */
export function ConfigSection(props: ConfigSectionProps): ReactElement {
  const { t, form, view, dirty } = props
  const busy = props.saving || props.testing
  const transport = detectRepoTransport(form.repoUrl)
  const meta = transportMeta(t, transport)
  const effectiveAuth = authForTransport(transport, form.authMode)
  const authVisible = transportUsesAuth(transport)
  const tokenVisible = authVisible && effectiveAuth === 'https-token'

  const tokenState =
    form.tokenEnvVar !== view.tokenEnvVar ? (
      <Badge tone="idle">{t('configTokenCheckAfterSave')}</Badge>
    ) : view.tokenAvailable ? (
      <Badge tone="success">{t('configTokenAvailable')}</Badge>
    ) : (
      <Badge tone="error">{t('configTokenUnavailable')}</Badge>
    )

  const configured = view.repoUrl.trim() !== ''

  return (
    <Card
      title={t('configTitle')}
      description={props.open ? t('configDesc') : undefined}
      trailing={
        <span className="dgs-trailingRow">
          {dirty ? <Badge tone="warn">{t('configUnsaved')}</Badge> : null}
          <Badge tone={configured ? 'success' : 'idle'}>
            {configured ? t('configConfigured') : t('configNotConfigured')}
          </Badge>
          <button
            type="button"
            className="dgs-disclosure"
            aria-expanded={props.open}
            aria-controls="dgs-config-body"
            onClick={props.onToggle}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              <path
                d="M4 6.5 8 10.5 12 6.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{props.open ? t('configCollapse') : t('configExpand')}</span>
          </button>
        </span>
      }
    >
      <div id="dgs-config-body" hidden={!props.open}>
      <div className="dgs-grid">
        <Field id="dgs-config-repo" label={t('configRepoUrl')} hint={t('configRepoUrlHint')}>
          <TextInput
            id="dgs-config-repo"
            value={form.repoUrl}
            placeholder="https://github.com/you/dsh-plugins.git"
            disabled={busy}
            inputMode="url"
            onChange={value => {
              props.onChange({ repoUrl: value })
            }}
          />
        </Field>
        <Field id="dgs-config-branch" label={t('configBranch')}>
          <TextInput
            id="dgs-config-branch"
            value={form.branch}
            placeholder="main"
            disabled={busy}
            onChange={value => {
              props.onChange({ branch: value })
            }}
          />
        </Field>

        {transport === 'none' ? null : (
          <div className="dgs-gridFull dgs-transportRow" role="status" aria-live="polite">
            <Badge tone="idle">{meta.label}</Badge>
            <span className="dgs-hint">{meta.hint}</span>
          </div>
        )}

        <Field id="dgs-config-backup-dir" label={t('configBackupDir')} hint={t('configBackupDirHint')}>
          <TextInput
            id="dgs-config-backup-dir"
            value={form.backupDir}
            placeholder="dsh-plugins"
            disabled={busy}
            onChange={value => {
              props.onChange({ backupDir: value })
            }}
          />
        </Field>

        {authVisible ? (
          <Field id="dgs-config-auth" label={t('configAuthMode')} hint={t(AUTH_HINT[effectiveAuth])}>
            <Select
              id="dgs-config-auth"
              value={effectiveAuth}
              disabled={busy}
              options={
                transport === 'https'
                  // An HTTPS URL cannot use the SSH agent; only HTTPS-capable
                  // modes are offered.
                  ? [
                      { value: 'credential-helper' as const, label: t('configAuthCredentialHelper') },
                      { value: 'https-token' as const, label: t('configAuthHttpsToken') },
                    ]
                  : [
                      { value: 'credential-helper' as const, label: t('configAuthCredentialHelper') },
                      { value: 'ssh' as const, label: t('configAuthSsh') },
                      { value: 'https-token' as const, label: t('configAuthHttpsToken') },
                    ]
              }
              onChange={value => {
                props.onChange({ authMode: value })
              }}
            />
          </Field>
        ) : null}

        {tokenVisible ? (
          <>
            <Field id="dgs-config-token-env" label={t('configTokenEnvVar')} hint={t('configTokenEnvVarHint')}>
              <div className="dgs-inlineRow">
                <TextInput
                  id="dgs-config-token-env"
                  value={form.tokenEnvVar}
                  placeholder="GITHUB_TOKEN"
                  disabled={busy}
                  onChange={value => {
                    props.onChange({ tokenEnvVar: value })
                  }}
                />
                {tokenState}
              </div>
            </Field>
            <Field id="dgs-config-username" label={t('configUsername')} hint={t('configUsernameHint')}>
              <TextInput
                id="dgs-config-username"
                value={form.username}
                placeholder="git"
                disabled={busy}
                onChange={value => {
                  props.onChange({ username: value })
                }}
              />
            </Field>
          </>
        ) : null}

        <Field id="dgs-config-device" label={t('configDeviceName')} hint={t('configDeviceNameHint')}>
          <TextInput
            id="dgs-config-device"
            value={form.deviceName}
            disabled={busy}
            onChange={value => {
              props.onChange({ deviceName: value })
            }}
          />
        </Field>
      </div>

      <div className="dgs-field">
        <span className="dgs-label">{t('configProfiles')}</span>
        <div className="dgs-btnRow">
          {profilesOf(view).map(profile => (
            <Badge key={profile} tone={profile === view.activeProfile ? 'success' : 'idle'}>
              {profile === view.activeProfile
                ? `${profile} · ${t('profileActive')}`
                : `${profile} · ${t('profileUnsupported')}`}
            </Badge>
          ))}
        </div>
        <span className="dgs-hint">{t('configProfilesHint')}</span>
      </div>

      <div className="dgs-btnRow">
        <Button onClick={props.onTest} disabled={busy}>
          {props.testing ? t('configTesting') : t('configTest')}
        </Button>
        <Button variant="primary" onClick={props.onSave} disabled={busy || !dirty}>
          {props.saving ? t('saving') : t('save')}
        </Button>
      </div>

      {props.connection === null ? null : (
        <>
          <Banner tone={props.connection.ok ? 'success' : 'error'}>
            {props.connection.ok
              ? t('configConnectionOk', { message: props.connection.message })
              : t('configConnectionFail', { message: props.connection.message })}
          </Banner>
          {props.connection.ok ? (
            <p className="dgs-hint dgs-mono">
              {t('configConnectionMeta', {
                branch: props.connection.branch ?? t('notAvailable'),
                head: props.connection.head === null || props.connection.head === undefined
                  ? t('notAvailable')
                  : shortCommit(props.connection.head),
                auth: props.connection.authMethod ?? t('notAvailable'),
              })}{' '}
              · {formatDateTime(props.connection.at, t('unknown'))}
            </p>
          ) : null}
        </>
      )}
      </div>
    </Card>
  )
}

/**
 * Every profile the Host names, active first. The page never edits this list
 * (v1 synchronizes the active profile only) — it just shows what the Host
 * reports, so a future multi-profile release needs no client change beyond
 * the "not supported yet" copy.
 */
function profilesOf(view: SyncConfigView): string[] {
  const seen = new Set<string>()
  const profiles: string[] = []
  for (const profile of [view.activeProfile, ...view.profiles, ...view.availableProfiles]) {
    if (profile === '' || seen.has(profile)) continue
    seen.add(profile)
    profiles.push(profile)
  }
  return profiles
}
