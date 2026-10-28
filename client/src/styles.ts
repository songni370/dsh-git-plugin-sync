/**
 * Scoped stylesheet for the settings page, rendered as a `<style>` element
 * INSIDE the page root by {@link Page}. Two reasons for that placement:
 *  - unmounting the section removes the sheet with the component (no global
 *    style left behind, no `document.head` write from plugin code);
 *  - every rule is prefixed `dgs-`, so the sheet cannot collide with host or
 *    other-plugin classes even while both are in the document.
 *
 * Color rules: every color is a `--dsw-alias-*` theme token, so light/dark
 * follows the host palette with no client-side theme detection. Each `var()`
 * carries the light-mode literal as its fallback, matching the host's own
 * sheets. Fonts, spacing, radii and layout use literals — they are not colors.
 * @module styles
 */

/** The page stylesheet, as one constant string. */
export const CSS = `
.dgs-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 0 2px 8px;
  color: var(--dsw-alias-label-primary, #1f2328);
  font-size: 14px;
  line-height: 22px;
}
.dgs-intro {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  box-sizing: border-box;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
}
.dgs-cardHead {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dgs-headRow {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
}
.dgs-cardTitle {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1f2328);
}
.dgs-cardDesc {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px 16px;
}
.dgs-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dgs-label {
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-hint {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-input,
.dgs-select {
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, #d9dde3);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: var(--dsw-alias-label-primary, #1f2328);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}
.dgs-input::placeholder {
  color: var(--dsw-alias-label-secondary, #5c6570);
  opacity: 1;
}
.dgs-input:disabled,
.dgs-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.dgs-inlineRow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dgs-inlineRow > .dgs-input {
  flex: 1 1 auto;
}
.dgs-selectInline {
  width: auto;
  min-width: 160px;
}
.dgs-btnRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.dgs-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2, #d9dde3);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2, #f3f4f6);
  color: var(--dsw-alias-label-primary, #1f2328);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.dgs-btn:hover:not(:disabled) {
  background: var(--dsw-alias-bg-base, #ffffff);
}
.dgs-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dgs-btnPrimary {
  border-color: var(--dsw-alias-brand-primary, #4f6ef7);
  background: var(--dsw-alias-brand-primary, #4f6ef7);
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
}
.dgs-btnPrimary:hover:not(:disabled) {
  background: var(--dsw-alias-brand-primary, #4f6ef7);
  opacity: 0.92;
}
.dgs-btnDanger {
  border-color: var(--dsw-alias-state-error-primary, #dc2626);
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-state-error-primary, #dc2626);
}
.dgs-btnSmall {
  height: 26px;
  padding: 0 8px;
  font-size: 12px;
}
.dgs-linkBtn {
  padding: 0;
  border: none;
  background: none;
  color: var(--dsw-alias-brand-primary, #4f6ef7);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  text-decoration: underline;
  cursor: pointer;
}
.dgs-root button:focus-visible,
.dgs-root input:focus-visible,
.dgs-root select:focus-visible,
.dgs-root [tabindex]:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4f6ef7);
  outline-offset: 2px;
}
.dgs-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, #d9dde3);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, #f3f4f6);
  color: var(--dsw-alias-label-secondary, #5c6570);
  font-size: 12px;
  line-height: 20px;
  font-weight: 500;
  white-space: nowrap;
}
.dgs-badgeSuccess {
  border-color: var(--dsw-alias-state-success-primary, #16a34a);
  color: var(--dsw-alias-state-success-primary, #16a34a);
}
.dgs-badgeWarn {
  border-color: var(--dsw-alias-state-warn-primary, #d97706);
  color: var(--dsw-alias-state-warn-primary, #d97706);
}
.dgs-badgeError {
  border-color: var(--dsw-alias-state-error-primary, #dc2626);
  color: var(--dsw-alias-state-error-primary, #dc2626);
}
.dgs-badgeIdle {
  border-color: var(--dsw-alias-border-l2, #d9dde3);
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-banner {
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  margin: 0;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l2, #d9dde3);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #f3f4f6);
  color: var(--dsw-alias-label-secondary, #5c6570);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.dgs-bannerError {
  border-color: var(--dsw-alias-state-error-primary, #dc2626);
  color: var(--dsw-alias-state-error-primary, #dc2626);
}
.dgs-bannerWarn {
  border-color: var(--dsw-alias-state-warn-primary, #d97706);
  color: var(--dsw-alias-state-warn-primary, #d97706);
}
.dgs-bannerSuccess {
  border-color: var(--dsw-alias-state-success-primary, #16a34a);
  color: var(--dsw-alias-state-success-primary, #16a34a);
}
.dgs-kv {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px 16px;
  margin: 0;
}
.dgs-kvItem {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dgs-kvLabel {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-kvValue {
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary, #1f2328);
  overflow-wrap: anywhere;
}
.dgs-tableWrap {
  width: 100%;
  min-width: 0;
  overflow-x: auto;
}
.dgs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  line-height: 20px;
}
.dgs-table th {
  padding: 6px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  color: var(--dsw-alias-label-secondary, #5c6570);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  white-space: nowrap;
}
.dgs-table td {
  padding: 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  color: var(--dsw-alias-label-primary, #1f2328);
  vertical-align: middle;
}
.dgs-table tr:last-child td {
  border-bottom: none;
}
.dgs-tableCellCheck {
  width: 1%;
  white-space: nowrap;
}
.dgs-pluginCell {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.dgs-pluginName {
  font-weight: 500;
  overflow-wrap: anywhere;
}
.dgs-pluginId {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary, #5c6570);
  overflow-wrap: anywhere;
}
.dgs-nowrap {
  white-space: nowrap;
}
.dgs-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.dgs-muted {
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-small {
  font-size: 12px;
  line-height: 18px;
}
.dgs-switchRow {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
}
.dgs-switchText {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dgs-switchLabel {
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, #1f2328);
}
.dgs-switch {
  position: relative;
  flex: 0 0 auto;
  box-sizing: border-box;
  width: 38px;
  height: 22px;
  margin: 1px 0 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 999px;
  /* OFF must be readable in BOTH themes: bg-layer-2 was nearly white on a
     white card, and the white knob disappeared. label-secondary is mid-tone
     in light and dark, so the knob (bg-base: white in light, dark in dark)
     always contrasts. */
  background: var(--dsw-alias-label-secondary, #6b7280);
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}
.dgs-switch:hover {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4f6ef7) 16%, transparent);
}
.dgs-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-base, #ffffff);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.35);
  transition: transform 120ms ease;
}
.dgs-switch[aria-checked='true'] {
  /* On = success green in both themes (#22c55e in the shipped palette);
     the knob stays bg-base (white in light, near-black in dark). */
  border-color: var(--dsw-alias-state-success-primary, #22c55e);
  background: var(--dsw-alias-state-success-primary, #22c55e);
}
.dgs-switch[aria-checked='true']::after {
  transform: translateX(16px);
}
.dgs-switch:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4f6ef7);
  outline-offset: 2px;
}
.dgs-switch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dgs-checkbox {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--dsw-alias-brand-primary, #4f6ef7);
  cursor: pointer;
}
.dgs-checkbox:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dgs-planSection {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.dgs-planHeading {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1f2328);
}
.dgs-planList {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dgs-planItem {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
}
.dgs-planItemDestructive {
  border-color: var(--dsw-alias-state-error-primary, #dc2626);
}
.dgs-planName {
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, #1f2328);
  overflow-wrap: anywhere;
}
.dgs-planDetail {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6570);
  overflow-wrap: anywhere;
}
.dgs-plainList {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6570);
  overflow-wrap: anywhere;
}
.dgs-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-modalOverlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 24px;
  background: var(--dsw-alias-bg-mask-1, rgba(15, 23, 42, 0.42));
}
.dgs-modal {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(560px, 100%);
  max-height: min(80vh, 720px);
  border: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base, #ffffff);
  box-shadow: var(--dsw-shadow-lv2, 0 16px 48px rgba(15, 23, 42, 0.18));
  outline: none;
}
.dgs-modalHead {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 20px 0;
}
.dgs-modalTitle {
  margin: 0;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1f2328);
}
.dgs-modalDesc {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-modalBody {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 20px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 20px;
}
.dgs-modalFoot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
}
.dgs-srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 520px) {
  .dgs-card {
    padding: 12px;
  }
  .dgs-modalOverlay {
    padding: 12px;
  }
}
`
