/**
 * "Repository" card: where the backup lives and how to authenticate.
 *
 * Layout follows the host's own settings pages: one label column, one control
 * column, short helper text under the control, and secondary options behind an
 * "Advanced" disclosure. Only the two things every setup needs stay visible —
 * the repository address and (for HTTPS) the authentication choice.
 *
 * The token is NEVER a field here. The Host stores the environment variable
 * NAME and reports whether that variable currently holds a value; the page
 * shows the name plus availability and has no way to read or write the secret.
 * @module ui/ConfigSection
 */

import { useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { GitAuthMode, SyncConfigView } from '../../../src/types'
import type { Translate } from '../i18n'
import {
  authForTransport,
  detectRepoTransport,
  type RepoTransport,
} from '../repo-transport'
import { Badge, Button, Card, TextInput } from './controls'

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
    // an auth control with no matching option; show the mode that fits.
    authMode: authForTransport(detectRepoTransport(view.repoUrl), view.authMode),
    tokenEnvVar: view.tokenEnvVar,
    username: view.username,
    deviceName: view.deviceName,
  }
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
  onChange: (patch: Partial<ConfigForm>) => void
  onTest: () => void
  onSave: () => void
  /** Whether the form body is expanded. */
  open: boolean
  /** Expand/collapse the card body. */
  onToggle: () => void
  /** Result of testing/saving, shown inside this card. */
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

/** One label/control row of the settings-style form. */
function FormRow(props: {
  label: string
  children: ReactNode
}): ReactElement {
  return (
    <div className="dgs-formRow">
      <span className="dgs-formRowLabel">{props.label}</span>
      <div className="dgs-formRowControl">{props.children}</div>
    </div>
  )
}

/** Render the repository-configuration card. */
export function ConfigSection(props: ConfigSectionProps): ReactElement {
  const { t, form, view, dirty } = props
  const busy = props.saving || props.testing
  const transport = detectRepoTransport(form.repoUrl)
  const meta = transportMeta(t, transport)
  const effectiveAuth = authForTransport(transport, form.authMode)
  const tokenVisible = transport === 'https' && effectiveAuth === 'https-token'
  // A fresh install opens the secondary options; a configured device keeps the
  // card short and puts them one click away.
  const [advancedOpen, setAdvancedOpen] = useState(() => view.repoUrl.trim() === '')

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
        <div className="dgs-formRows">
          <FormRow label={t('configRepoUrl')}>
            <div className="dgs-inputWithBadge">
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
              {transport === 'none' ? null : <Badge tone="idle">{meta.label}</Badge>}
            </div>
            {transport === 'none' ? (
              <span className="dgs-formRowHint">{t('configRepoUrlHint')}</span>
            ) : transport === 'https' ? null : (
              // HTTPS is explained by its auth rows below; SSH/local/other
              // keep one short hint under the address.
              <span className="dgs-formRowHint">{meta.hint}</span>
            )}
          </FormRow>

          {transport === 'https' ? (
            <>
              <FormRow label={t('configAuthMode')}>
                <div
                  id="dgs-config-auth"
                  className="dgs-segmented"
                  role="radiogroup"
                  aria-label={t('configAuthMode')}
                >
                  {([
                    { value: 'credential-helper' as const, label: t('configAuthCredentialHelper') },
                    { value: 'https-token' as const, label: t('configAuthHttpsToken') },
                  ]).map(option => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={effectiveAuth === option.value}
                      disabled={busy}
                      onClick={() => {
                        props.onChange({ authMode: option.value })
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </FormRow>

              {tokenVisible ? (
                <>
                  <FormRow label={t('configTokenEnvVar')}>
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
                    <span className="dgs-formRowHint">{t('configTokenEnvVarHint')}</span>
                  </FormRow>
                  <FormRow label={t('configUsername')}>
                    <TextInput
                      id="dgs-config-username"
                      value={form.username}
                      placeholder="git"
                      disabled={busy}
                      onChange={value => {
                        props.onChange({ username: value })
                      }}
                    />
                    <span className="dgs-formRowHint">{t('configUsernameHint')}</span>
                  </FormRow>
                </>
              ) : null}
            </>
          ) : null}

          <div className="dgs-advanced">
            <button
              type="button"
              className="dgs-advancedToggle"
              aria-expanded={advancedOpen}
              aria-controls="dgs-config-advanced"
              onClick={() => {
                setAdvancedOpen(current => !current)
              }}
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
              <span>{t('configAdvanced')}</span>
            </button>
            <div id="dgs-config-advanced" className="dgs-formRows dgs-advancedBody" hidden={!advancedOpen}>
              <FormRow label={t('configBranch')}>
                <TextInput
                  id="dgs-config-branch"
                  value={form.branch}
                  placeholder="main"
                  disabled={busy}
                  onChange={value => {
                    props.onChange({ branch: value })
                  }}
                />
              </FormRow>
              <FormRow label={t('configBackupDir')}>
                <TextInput
                  id="dgs-config-backup-dir"
                  value={form.backupDir}
                  placeholder="dsh-plugins"
                  disabled={busy}
                  onChange={value => {
                    props.onChange({ backupDir: value })
                  }}
                />
                <span className="dgs-formRowHint">{t('configBackupDirHint')}</span>
              </FormRow>
              <FormRow label={t('configDeviceName')}>
                <TextInput
                  id="dgs-config-device"
                  value={form.deviceName}
                  disabled={busy}
                  onChange={value => {
                    props.onChange({ deviceName: value })
                  }}
                />
                <span className="dgs-formRowHint">{t('configDeviceNameHint')}</span>
              </FormRow>
              <FormRow label={t('configClient')}>
                <div className="dgs-btnRow">
                  <Badge tone="success">{clientLabel(t, view.activeProfile)}</Badge>
                </div>
                <span className="dgs-formRowHint">{t('configClientHint')}</span>
              </FormRow>
            </div>
          </div>
        </div>

        <div className="dgs-formActions">
          <Button onClick={props.onTest} disabled={busy} loading={props.testing}>
            {props.testing ? t('configTesting') : t('configTest')}
          </Button>
          <Button variant="primary" onClick={props.onSave} disabled={busy || !dirty} loading={props.saving}>
            {props.saving ? t('saving') : t('save')}
          </Button>
        </div>

      </div>
    </Card>
  )
}

/** Plain-language name of the client the active profile belongs to. */
function clientLabel(t: Translate, profile: string): string {
  if (profile === 'desktop') return t('clientDesktop')
  if (profile === 'web') return t('clientWeb')
  return profile === '' ? t('notAvailable') : profile
}
