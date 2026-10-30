/**
 * Floating feedback should not take layout space: it renders in a fixed
 * bottom-centre stack and can be dismissed independently.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ToastStack } from '../../client/src/ui/ToastStack'
import { createTranslate, zh } from '../../client/src/i18n'

const t = createTranslate(key => zh[key] ?? key)

describe('ToastStack', () => {
  it('renders nothing when there is no feedback', () => {
    expect(renderToStaticMarkup(<ToastStack t={t} items={[]} onDismiss={() => undefined} />)).toBe('')
  })

  it('renders success and error feedback in a fixed stack with a close control', () => {
    const html = renderToStaticMarkup(
      <ToastStack
        t={t}
        items={[
          { key: 'config', tone: 'success', text: '配置已保存。' },
          { key: 'plugins', tone: 'error', text: '保存失败' },
        ]}
        onDismiss={() => undefined}
      />,
    )
    expect(html).toContain('dgs-toastStack')
    expect(html).toContain('dgs-toastSuccess')
    expect(html).toContain('dgs-toastError')
    expect(html).toContain('配置已保存。')
    expect(html).toContain('保存失败')
    expect(html).toContain('role="alert"')
    expect(html).toContain('aria-label="关闭"')
  })
})
