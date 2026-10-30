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
.dgs-root [hidden] {
  display: none !important;
}
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
.dgs-trailingRow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.dgs-gridFull {
  grid-column: 1 / -1;
}
.dgs-transportRow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: -2px 0 0;
  padding: 7px 10px;
  border: 1px solid var(--dsw-alias-border-l1, #e1e5ee);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #f7f8fa);
}
.dgs-transportRow .dgs-hint {
  margin: 0;
}
.dgs-disclosure {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px 0 8px;
  border: 1px solid var(--dsw-alias-border-l1, #e1e5ee);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.dgs-disclosure svg {
  transition: transform 150ms ease;
}
.dgs-disclosure[aria-expanded='true'] svg {
  transform: rotate(180deg);
}
.dgs-disclosure:hover {
  background: var(--dsw-alias-bg-layer-2, #f1f3f5);
  border-color: var(--dsw-alias-border-l2, #cfd3d6);
  color: var(--dsw-alias-label-primary, #0f1115);
}
.dgs-disclosure:active {
  transform: translateY(1px);
}
.dgs-disclosure:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  align-items: start;
}
.dgs-formRows {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.dgs-formRow {
  display: grid;
  grid-template-columns: 116px minmax(0, 1fr);
  gap: 4px 16px;
  align-items: start;
  min-width: 0;
}
.dgs-formRowLabel {
  padding-top: 7px;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-formRowControl {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.dgs-inputWithBadge {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dgs-inputWithBadge > .dgs-input {
  flex: 1 1 auto;
  min-width: 0;
}
.dgs-inputWithBadge > .dgs-badge {
  flex: none;
}
.dgs-formRowMeta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.dgs-formRowHint {
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-segmented {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  width: fit-content;
  max-width: 100%;
  border: 1px solid var(--dsw-alias-border-l1, #e1e5ee);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #f7f8fa);
}
.dgs-segmented > button {
  height: 26px;
  padding: 0 11px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #5c6570);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}
.dgs-segmented > button:hover {
  color: var(--dsw-alias-label-primary, #1f2328);
}
.dgs-segmented > button[aria-checked='true'] {
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-primary, #1f2328);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
}
.dgs-segmented > button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.dgs-advanced {
  margin-top: 2px;
  padding-top: 10px;
  border-top: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
}
.dgs-advancedToggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #5c6570);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  cursor: pointer;
}
.dgs-advancedToggle svg {
  transition: transform 150ms ease;
}
.dgs-advancedToggle[aria-expanded='true'] svg {
  transform: rotate(180deg);
}
.dgs-advancedToggle:hover {
  color: var(--dsw-alias-label-primary, #1f2328);
}
.dgs-advancedBody {
  padding-top: 12px;
}
.dgs-formActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
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
  border: 1px solid var(--dsw-alias-border-l1, #e1e5ee);
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #ffffff);
  color: var(--dsw-alias-label-primary, #1f2328);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  transition: border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
}
.dgs-select {
  padding-right: 30px;
  cursor: pointer;
}
.dgs-input:hover,
.dgs-select:hover {
  border-color: var(--dsw-alias-border-l2, #cfd3d6);
}
.dgs-input:focus,
.dgs-select:focus {
  outline: none;
  border-color: var(--dsw-alias-brand-primary, #0f1115);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #0f1115) 14%, transparent);
}
.dgs-input::placeholder {
  color: var(--dsw-alias-label-secondary, #5c6570);
  opacity: 0.65;
}
.dgs-input:disabled,
.dgs-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  background: var(--dsw-alias-bg-layer-2, #f7f8fa);
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
.dgs-historySummary {
  display: flex;
  align-items: center;
  gap: 4px 14px;
  flex-wrap: wrap;
}
.dgs-historySummaryItem {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-historyList {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dgs-historyItem {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  box-sizing: border-box;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
}
.dgs-historyItem > .dgs-btn {
  flex: none;
}
.dgs-historyDot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-historyDotOk {
  background: var(--dsw-alias-state-success-primary, #22c55e);
}
.dgs-historyDotFail {
  background: var(--dsw-alias-state-error-primary, #dc2626);
}
.dgs-historyDotIdle {
  background: var(--dsw-alias-border-l2, #cfd3d6);
}
.dgs-historyMain {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}
.dgs-historyTop {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.dgs-historyOp {
  font-size: 13px;
  line-height: 19px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1f2328);
}
.dgs-historyMeta {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-historySubject {
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-secondary, #5c6570);
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dgs-historyMetaRow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--dsw-alias-label-secondary, #5c6570);
  font-size: 11px;
  line-height: 16px;
}
.dgs-pluginsFilterRow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dgs-pluginsFilterInput {
  flex: 1 1 220px;
  width: auto;
  min-width: 0;
  max-width: 420px;
}
.dgs-pluginsBody {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.dgs-pluginsPageSize {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.dgs-pageSizeSelect {
  width: 76px;
}
.dgs-spinner {
  display: inline-block;
  flex: none;
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  opacity: 0.85;
  animation: dgs-spin 0.7s linear infinite;
}
@keyframes dgs-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dgs-spinner {
    animation-duration: 1.6s;
  }
}
.dgs-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding-top: 10px;
  border-top: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
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
.dgs-syncStatusBlock {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  margin-top: 2px;
  padding-top: 14px;
  border-top: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
}
.dgs-syncStatusHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.dgs-syncStatusTitle {
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1f2328);
}
.dgs-actionsNotices {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dgs-actionsMain {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dgs-moreActions {
  position: relative;
  /* Sits right after 检查差异, with a deliberately larger gap than the two
     primary buttons. */
  margin-left: 16px;
}
.dgs-moreSummary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l1, #e1e5ee);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #5c6570);
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  list-style: none;
  cursor: pointer;
  user-select: none;
}
.dgs-moreSummary::-webkit-details-marker {
  display: none;
}
.dgs-moreSummary::after {
  content: '▾';
  font-size: 10px;
  line-height: 1;
}
.dgs-moreActions[open] .dgs-moreSummary {
  background: var(--dsw-alias-bg-layer-2, #f7f8fa);
  color: var(--dsw-alias-label-primary, #1f2328);
}
.dgs-moreMenu {
  position: absolute;
  left: 0;
  top: calc(100% + 6px);
  /* Invisible bridge over the 6px gap so moving into the popup stays "inside"
     the menu and does not trigger the auto-close. */
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 180px;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l1, #e1e5ee);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
}
.dgs-moreMenu::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: -6px;
  height: 6px;
}
.dgs-moreItem {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #1f2328);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}
.dgs-moreItem:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2, #f7f8fa);
}
.dgs-moreItemDanger {
  color: var(--dsw-alias-state-error-primary, #dc2626);
}
.dgs-moreItem:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dgs-autoSection {
  margin-top: 2px;
  padding-top: 14px;
  border-top: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
}
.dgs-autoHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.dgs-autoHeaderMain {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.dgs-autoTitle {
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1f2328);
}
.dgs-autoSummary {
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6570);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dgs-autoHeaderActions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dgs-autoBody {
  padding-top: 12px;
}
.dgs-hintWarn {
  color: var(--dsw-alias-state-warn-primary, #b45309);
}
.dgs-autoNumber {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dgs-autoNumber .dgs-input {
  flex: 0 0 auto;
  width: 96px;
}
.dgs-autoUnit {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-checkRowGroup {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
}
.dgs-checkRow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary, #1f2328);
  cursor: pointer;
}
.dgs-checkRow input {
  margin: 0;
}
.dgs-statusTiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
  gap: 8px;
}
.dgs-statusTile {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #f7f8fa);
}
.dgs-statusTileValue {
  font-size: 18px;
  line-height: 24px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--dsw-alias-label-primary, #1f2328);
  font-variant-numeric: tabular-nums;
}
.dgs-statusTileLabel {
  min-width: 0;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary, #5c6570);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dgs-statusTileWarn .dgs-statusTileValue {
  color: var(--dsw-alias-state-warn-primary, #b45309);
}
.dgs-statusTileError .dgs-statusTileValue {
  color: var(--dsw-alias-state-error-primary, #dc2626);
}
.dgs-statusMeta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
  min-width: 0;
}
.dgs-statusMetaItem {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.dgs-statusMetaLabel {
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-statusMetaValue {
  display: block;
  min-width: 0;
  font-size: 13px;
  line-height: 19px;
  color: var(--dsw-alias-label-primary, #1f2328);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dgs-statusMetaValueWrap {
  display: -webkit-box;
  white-space: normal;
  overflow-wrap: anywhere;
  text-overflow: clip;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dgs-statusConnection {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.dgs-statusConnectionText {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #5c6570);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dgs-statusMetaValueWrap .dgs-statusConnection {
  display: block;
}
.dgs-statusMetaValueWrap .dgs-statusConnectionText {
  display: inline;
  white-space: normal;
}
.dgs-diffPanel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  box-sizing: border-box;
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2, #f7f8fa);
}
.dgs-diffHead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.dgs-diffHeadText {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dgs-diffTitle {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1f2328);
}
.dgs-diffDesc {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #5c6570);
}
.dgs-planSummary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.dgs-planSummaryItem {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  color: var(--dsw-alias-label-secondary, #5c6570);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}
.dgs-planSummaryItemWarn {
  border-color: var(--dsw-alias-state-warn-primary, #b45309);
  color: var(--dsw-alias-state-warn-primary, #b45309);
}
.dgs-planSummaryItemError {
  border-color: var(--dsw-alias-state-error-primary, #dc2626);
  color: var(--dsw-alias-state-error-primary, #dc2626);
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
  flex-direction: column;
  gap: 3px;
  box-sizing: border-box;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
}
.dgs-planItemDestructive {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #dc2626) 45%, var(--dsw-alias-border-l1, #e5e7eb));
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #dc2626) 5%, var(--dsw-alias-bg-layer-1, #ffffff));
}
.dgs-planItemHead {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.dgs-planName {
  font-size: 13px;
  line-height: 19px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, #1f2328);
  overflow-wrap: anywhere;
}
.dgs-planKind {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-2, #f7f8fa);
  color: var(--dsw-alias-label-secondary, #5c6570);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}
.dgs-planDetail {
  min-width: 0;
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

.dgs-conflictSection {
  gap: 8px;
}
.dgs-conflictList {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dgs-conflictCard {
  display: flex;
  flex-direction: column;
  gap: 7px;
  box-sizing: border-box;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b45309) 45%, var(--dsw-alias-border-l1, #e5e7eb));
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #b45309) 4%, var(--dsw-alias-bg-layer-1, #ffffff));
}
.dgs-conflictHead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.dgs-conflictMeta {
  min-width: 0;
  color: var(--dsw-alias-label-secondary, #5c6570);
  font-size: 11px;
  line-height: 16px;
  overflow-wrap: anywhere;
}
.dgs-conflictReason {
  margin: 0;
  color: var(--dsw-alias-label-primary, #1f2328);
  font-size: 13px;
  line-height: 18px;
}
.dgs-conflictFields {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.dgs-conflictField {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-2, #f7f8fa);
  color: var(--dsw-alias-label-secondary, #5c6570);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}
.dgs-choiceGroup {
  display: flex;
  align-self: flex-start;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, #d9dde3);
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
}
.dgs-choice {
  min-height: 28px;
  padding: 0 11px;
  border: 0;
  border-right: 1px solid var(--dsw-alias-border-l1, #e5e7eb);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #5c6570);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
.dgs-choice:last-child {
  border-right: 0;
}
.dgs-choice:hover {
  background: var(--dsw-alias-bg-layer-2, #f7f8fa);
  color: var(--dsw-alias-label-primary, #1f2328);
}
.dgs-choiceActive,
.dgs-choiceActive:hover {
  background: var(--dsw-alias-brand-primary, #0f1115);
  color: #ffffff;
}
.dgs-choice:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #0f1115);
  outline-offset: -2px;
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
@media (max-width: 560px) {
  .dgs-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .dgs-formRow {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .dgs-statusMeta {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }
  .dgs-formRowLabel {
    padding-top: 0;
  }
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
