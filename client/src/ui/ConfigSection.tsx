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
    authMode: view.authMode,
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
}

/** Render the repository-configuration card. */
export function ConfigSection(props: ConfigSectionProps): ReactElement {
  const { t, form, view, dirty } = props
  const busy = props.saving || props.testing

  const tokenState =
    form.tokenEnvVar !== view.tokenEnvVar ? (
      <Badge tone="idle">{t('configTokenCheckAfterSave')}</Badge>
    ) : view.tokenAvailable ? (
      <Badge tone="success">{t('configTokenAvailable')}</Badge>
    ) : (
      <Badge tone="error">{t('configTokenUnavailable')}</Badge>
    )

  return (
    <Card
      title={t('configTitle')}
      description={t('configDesc')}
      trailing={dirty ? <Badge tone="warn">{t('configUnsaved')}</Badge> : undefined}
    >
      <div className="dgs-grid">
        <Field id="dgs-config-repo" label={t('configRepoUrl')} hint={t('configRepoUrlHint')}>
          <TextInput
            id="dgs-config-repo"
            value={form.repoUrl}
            placeholder="https://github.com/you/dsh-plugins.git"
            disabled={busy}
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
        <Field id="dgs-config-auth" label={t('configAuthMode')} hint={t(AUTH_HINT[form.authMode])}>
          <Select
            id="dgs-config-auth"
            value={form.authMode}
            disabled={busy}
            options={[
              { value: 'credential-helper', label: t('configAuthCredentialHelper') },
              { value: 'ssh', label: t('configAuthSsh') },
              { value: 'https-token', label: t('configAuthHttpsToken') },
            ]}
            onChange={value => {
              props.onChange({ authMode: value })
            }}
          />
        </Field>
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
