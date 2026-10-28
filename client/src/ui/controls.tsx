/**
 * Hand-written controls for the settings page.
 *
 * The project rule is no Harness primitives import (a value import from a
 * `@deepseek-ai/dsh-client-ui-*` package fails the client bundle-purity gate),
 * so this module is the page's whole widget vocabulary: plain HTML elements
 * with the `dgs-` classes from `styles.ts`, native semantics (label/for,
 * button/switch roles, real checkboxes) and theme-token colors only.
 * @module ui/controls
 */

import type { ChangeEvent, ReactElement, ReactNode } from 'react'

/** Visual tone of a badge or banner. */
export type Tone = 'idle' | 'success' | 'warn' | 'error'

const TONE_CLASS: Record<Tone, string> = {
  idle: 'dgs-badgeIdle',
  success: 'dgs-badgeSuccess',
  warn: 'dgs-badgeWarn',
  error: 'dgs-badgeError',
}

const BANNER_CLASS: Record<Tone, string> = {
  idle: '',
  success: 'dgs-bannerSuccess',
  warn: 'dgs-bannerWarn',
  error: 'dgs-bannerError',
}

/** One settings card: heading, optional description and trailing controls. */
export function Card(props: {
  title: string
  description?: string
  trailing?: ReactNode
  children: ReactNode
}): ReactElement {
  return (
    <section className="dgs-card">
      <div className="dgs-headRow">
        <div className="dgs-cardHead">
          <h3 className="dgs-cardTitle">{props.title}</h3>
          {props.description === undefined ? null : <p className="dgs-cardDesc">{props.description}</p>}
        </div>
        {props.trailing}
      </div>
      {props.children}
    </section>
  )
}

/** Button variants. `primary` is the section's one call to action. */
export type ButtonVariant = 'default' | 'primary' | 'danger'

/** A plain button; disabled state greys it out and blocks activation. */
export function Button(props: {
  children: ReactNode
  onClick?: () => void
  variant?: ButtonVariant
  disabled?: boolean
  small?: boolean
  type?: 'button' | 'submit'
  ariaLabel?: string
  title?: string
}): ReactElement {
  const classes = ['dgs-btn']
  if (props.variant === 'primary') classes.push('dgs-btnPrimary')
  if (props.variant === 'danger') classes.push('dgs-btnDanger')
  if (props.small === true) classes.push('dgs-btnSmall')
  return (
    <button
      type={props.type ?? 'button'}
      className={classes.join(' ')}
      onClick={props.onClick}
      disabled={props.disabled === true}
      aria-label={props.ariaLabel}
      title={props.title}
    >
      {props.children}
    </button>
  )
}

/** Inline text button (retry links). */
export function LinkButton(props: { children: ReactNode; onClick: () => void; disabled?: boolean }): ReactElement {
  return (
    <button type="button" className="dgs-linkBtn" onClick={props.onClick} disabled={props.disabled === true}>
      {props.children}
    </button>
  )
}

/** A status pill. */
export function Badge(props: { tone: Tone; children: ReactNode }): ReactElement {
  return <span className={`dgs-badge ${TONE_CLASS[props.tone]}`}>{props.children}</span>
}

/** An inline message strip. Errors are announced assertively. */
export function Banner(props: { tone: Tone; children: ReactNode }): ReactElement {
  const classes = ['dgs-banner']
  if (BANNER_CLASS[props.tone] !== '') classes.push(BANNER_CLASS[props.tone])
  const assertive = props.tone === 'error'
  return (
    <p className={classes.join(' ')} role={assertive ? 'alert' : 'status'} aria-live={assertive ? 'assertive' : 'polite'}>
      {props.children}
    </p>
  )
}

/** Label + hint + control, stacked. */
export function Field(props: {
  id: string
  label: string
  hint?: string
  children: ReactNode
}): ReactElement {
  return (
    <div className="dgs-field">
      <label className="dgs-label" htmlFor={props.id}>
        {props.label}
      </label>
      {props.children}
      {props.hint === undefined ? null : <span className="dgs-hint">{props.hint}</span>}
    </div>
  )
}

/** Text input. */
export function TextInput(props: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  inputMode?: 'text' | 'numeric' | 'url'
}): ReactElement {
  return (
    <input
      id={props.id}
      className="dgs-input"
      type="text"
      value={props.value}
      placeholder={props.placeholder}
      disabled={props.disabled === true}
      inputMode={props.inputMode}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        props.onChange(event.target.value)
      }}
    />
  )
}

/** Number input bound to a numeric value (empty falls back to `min`). */
export function NumberInput(props: {
  id: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  disabled?: boolean
}): ReactElement {
  return (
    <input
      id={props.id}
      className="dgs-input"
      type="number"
      min={props.min}
      max={props.max}
      step={1}
      value={String(props.value)}
      disabled={props.disabled === true}
      inputMode="numeric"
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        const parsed = Number.parseInt(event.target.value, 10)
        if (Number.isFinite(parsed)) props.onChange(Math.min(props.max, Math.max(props.min, parsed)))
      }}
    />
  )
}

/** Native select. */
export function Select<T extends string>(props: {
  id: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  disabled?: boolean
}): ReactElement {
  return (
    <select
      id={props.id}
      className="dgs-select"
      value={props.value}
      disabled={props.disabled === true}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => {
        props.onChange(event.target.value as T)
      }}
    >
      {props.options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/**
 * Inline switch row: title + hint on the left, `role="switch"` control on the
 * right. The control is a real button, so Space/Enter work and the checked
 * state is exposed through `aria-checked`.
 */
export function Switch(props: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}): ReactElement {
  return (
    <div className="dgs-switchRow">
      <span className="dgs-switchText">
        <span className="dgs-switchLabel">{props.label}</span>
        {props.hint === undefined ? null : <span className="dgs-hint">{props.hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        className="dgs-switch"
        disabled={props.disabled === true}
        onClick={() => {
          props.onChange(!props.checked)
        }}
      />
    </div>
  )
}

/** A native checkbox with an accessible name. */
export function Checkbox(props: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}): ReactElement {
  return (
    <input
      type="checkbox"
      className="dgs-checkbox"
      checked={props.checked}
      aria-label={props.label}
      title={props.disabled === true ? props.label : undefined}
      disabled={props.disabled === true}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        props.onChange(event.target.checked)
      }}
    />
  )
}

/** Label/value grid used by the status card. */
export function KeyValue(props: { items: ReadonlyArray<{ label: string; value: ReactNode }> }): ReactElement {
  return (
    <dl className="dgs-kv">
      {props.items.map(item => (
        <div key={item.label} className="dgs-kvItem">
          <dt className="dgs-kvLabel">{item.label}</dt>
          <dd className="dgs-kvValue">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Loading line. */
export function Loading(props: { text: string }): ReactElement {
  return (
    <p className="dgs-loading" role="status" aria-live="polite">
      {props.text}
    </p>
  )
}
