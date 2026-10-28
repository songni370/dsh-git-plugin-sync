/**
 * Secret detection and redaction.
 *
 * Three independent rules protect the user:
 * 1. config keys whose names look like credentials are never written;
 * 2. values that look like tokens, private keys or certificates are never
 *    written, whatever their key is called;
 * 3. every log line and every Git error message passes through
 *    {@link redactText} before it is stored or returned to a UI/tool.
 *
 * The rules are intentionally lossy: a false positive only means one config
 * value is not synchronized, while a false negative would publish a secret.
 * @module core/redact
 */

import type { JsonObject, JsonValue } from '../types.js'

/** Key-name fragments treated as credentials, matched case-insensitively. */
export const SENSITIVE_KEY_PATTERN =
  /(?:^|[._-])(api[_-]?key|apikey|token|secret|password|passwd|pwd|credential|credentials|auth|cookie|cookies|session[_-]?key|private[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|bearer|signature|signed[_-]?url|webhook[_-]?url)(?:$|[._-])/i

/** Extra fragments that are commonly credential-bearing in this ecosystem. */
export const SENSITIVE_KEY_HINTS = [
  'apikey',
  'api_key',
  'accesskey',
  'access_key',
  'secretkey',
  'secret_key',
  'privatekey',
  'private_key',
  'authorization',
  'auth_token',
  'authtoken',
  'x-api-key',
  'encryptionkey',
  'encryption_key',
  'ssh_key',
  'sshkey',
] as const

/** Value patterns that always look like secrets, regardless of key name. */
const SECRET_VALUE_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'openai-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { name: 'github-pat', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{16,}\b/ },
  { name: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'bearer-header', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/ },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'url-userinfo', pattern: /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i },
]

/** Whether a config key name must be treated as a secret. */
export function isSensitiveKey(key: string): boolean {
  if (key === '') return false
  const normalized = key.toLowerCase()
  if (SENSITIVE_KEY_PATTERN.test(key)) return true
  return SENSITIVE_KEY_HINTS.some(hint => normalized.includes(hint))
}

/** Whether a string value looks like a credential or secret. */
export function looksLikeSecretValue(value: string): boolean {
  if (value.length < 8) return false
  return SECRET_VALUE_PATTERNS.some(entry => entry.pattern.test(value))
}

/** Kind of secret a value looks like, for logs (never the value itself). */
export function secretKind(value: string): string | null {
  for (const entry of SECRET_VALUE_PATTERNS) if (entry.pattern.test(value)) return entry.name
  return null
}

/** Result of filtering one config object for synchronization. */
export interface FilteredConfig {
  /** Values safe to store in the backup. */
  values: JsonObject
  /** Keys dropped because they may be secrets. */
  skippedKeys: string[]
}

/**
 * Filter one config object. Nested keys are checked by their own name and the
 * full dotted path, and any string leaf that looks like a secret is dropped
 * together with its nearest top-level key so the shape stays consistent.
 */
export function filterSensitiveConfig(input: Record<string, unknown>): FilteredConfig {
  const values: JsonObject = {}
  const skippedKeys: string[] = []

  const walk = (value: unknown, keyPath: string[]): JsonValue | undefined => {
    const key = keyPath[keyPath.length - 1] ?? ''
    const dotted = keyPath.join('.')
    if (isSensitiveKey(key) || isSensitiveKey(dotted)) return undefined
    if (typeof value === 'string') {
      if (looksLikeSecretValue(value)) return undefined
      return value
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'boolean' || value === null) return value
    if (Array.isArray(value)) {
      const items: JsonValue[] = []
      for (const item of value) {
        const filtered = walk(item, [...keyPath, String(items.length)])
        if (filtered !== undefined) items.push(filtered)
      }
      return items
    }
    if (typeof value === 'object' && value !== null) {
      const proto = Object.getPrototypeOf(value)
      if (proto !== Object.prototype && proto !== null) return undefined
      const out: JsonObject = {}
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        const filtered = walk(childValue, [...keyPath, childKey])
        if (filtered !== undefined) out[childKey] = filtered
      }
      return out
    }
    return undefined
  }

  for (const [key, raw] of Object.entries(input)) {
    const filtered = walk(raw, [key])
    if (filtered === undefined) skippedKeys.push(key)
    else values[key] = filtered
  }
  return { values, skippedKeys }
}

/** Redact credentials embedded in a URL (keeps host/path, drops userinfo). */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.username !== '' || url.password !== '') {
      url.username = '***'
      url.password = '***'
    }
    return url.toString()
  } catch {
    // scp-like syntax: git@host:owner/repo.git — no secret to hide, but a
    // bare `user:pass@host` form without a scheme should never be logged.
    return raw.replace(/\/\/[^/@\s]+@/g, '//***@')
  }
}

/** Redact a Git URL for errors and logs. */
export function redactGitUrl(raw: string): string {
  return redactUrl(raw).replace(/\/\/\*\*\*:\*\*\*@/, '//***@')
}

/** Replace every known secret pattern and credential-looking assignment. */
export function redactText(raw: string): string {
  let text = raw
  for (const entry of SECRET_VALUE_PATTERNS) text = text.replace(entry.pattern, `[redacted:${entry.name}]`)
  text = text.replace(
    /((?:password|passwd|pwd|token|api[_-]?key|apikey|secret|authorization|access[_-]?key)\s*[:=]\s*)(['"]?)([^\s'",}]{4,})\2/gi,
    (_match, prefix: string, quote: string) => `${prefix}${quote}[redacted]${quote}`,
  )
  text = text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[redacted]@')
  return text
}

/** Redact an arbitrary JSON tree before logging or persisting. */
export function redactJson(value: JsonValue): JsonValue {
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map(redactJson)
  if (value !== null && typeof value === 'object') {
    const out: JsonObject = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? '[redacted]' : redactJson(item)
    }
    return out
  }
  return value
}
