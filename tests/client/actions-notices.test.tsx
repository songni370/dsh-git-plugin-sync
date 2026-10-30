/**
 * Status notices (not configured / busy / last error) belong to the operations
 * area, not inside the sync-status block.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActionsSection } from '../../client/src/ui/ActionsSection'
import { Banner } from '../../client/src/ui/controls'
import { createTranslate, zh } from '../../client/src/i18n'

const t = createTranslate(key => zh[key] ?? key)

function render(busy: 'sync' | 'diff' | null = null): string {
  return renderToStaticMarkup(
    <ActionsSection
      t={t}
      busy={busy}
      hostBusy={false}
      enabled
      diff={null}
      onBackup={() => undefined}
      onRestore={() => undefined}
      onSync={() => undefined}
      onDiff={() => undefined}
      onClearDiff={() => undefined}
      notices={
        <>
          <Banner tone="warn">BUSY-NOTICE</Banner>
          <Banner tone="error">ERROR-NOTICE</Banner>
        </>
      }
      statusPanel={<div className="dgs-syncStatusBlock">STATUS-BLOCK</div>}
    />,
  )
}

describe('actions notices', () => {
  it('renders status notices above the status block', () => {
    const html = render()
    expect(html).toContain('BUSY-NOTICE')
    expect(html).toContain('ERROR-NOTICE')
    expect(html).toContain('STATUS-BLOCK')
    expect(html.indexOf('BUSY-NOTICE')).toBeLessThan(html.indexOf('STATUS-BLOCK'))
    expect(html.indexOf('ERROR-NOTICE')).toBeLessThan(html.indexOf('STATUS-BLOCK'))
  })

  it('shows a spinner on the action that is running', () => {
    const html = render('sync')
    expect(html).toContain('dgs-spinner')
    expect(html).toContain('aria-busy="true"')
  })
})
