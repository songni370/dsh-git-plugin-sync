import { useState } from 'react'
import type { ReactNode } from 'react'

export interface ProbeProps { t: (key: string) => string; children?: ReactNode }

export function Probe({ t }: ProbeProps) {
  const [n] = useState(0)
  return <div>{t('a')}{n}</div>
}
