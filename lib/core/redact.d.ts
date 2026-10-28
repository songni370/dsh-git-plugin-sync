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
import type { JsonObject, JsonValue } from '../types.js';
/** Key-name fragments treated as credentials, matched case-insensitively. */
export declare const SENSITIVE_KEY_PATTERN: RegExp;
/** Extra fragments that are commonly credential-bearing in this ecosystem. */
export declare const SENSITIVE_KEY_HINTS: readonly ["apikey", "api_key", "accesskey", "access_key", "secretkey", "secret_key", "privatekey", "private_key", "authorization", "auth_token", "authtoken", "x-api-key", "encryptionkey", "encryption_key", "ssh_key", "sshkey"];
/** Whether a config key name must be treated as a secret. */
export declare function isSensitiveKey(key: string): boolean;
/** Whether a string value looks like a credential or secret. */
export declare function looksLikeSecretValue(value: string): boolean;
/** Kind of secret a value looks like, for logs (never the value itself). */
export declare function secretKind(value: string): string | null;
/** Result of filtering one config object for synchronization. */
export interface FilteredConfig {
    /** Values safe to store in the backup. */
    values: JsonObject;
    /** Keys dropped because they may be secrets. */
    skippedKeys: string[];
}
/**
 * Filter one config object. Nested keys are checked by their own name and the
 * full dotted path, and any string leaf that looks like a secret is dropped
 * together with its nearest top-level key so the shape stays consistent.
 */
export declare function filterSensitiveConfig(input: Record<string, unknown>): FilteredConfig;
/** Redact credentials embedded in a URL (keeps host/path, drops userinfo). */
export declare function redactUrl(raw: string): string;
/** Redact a Git URL for errors and logs. */
export declare function redactGitUrl(raw: string): string;
/** Replace every known secret pattern and credential-looking assignment. */
export declare function redactText(raw: string): string;
/** Redact an arbitrary JSON tree before logging or persisting. */
export declare function redactJson(value: JsonValue): JsonValue;
