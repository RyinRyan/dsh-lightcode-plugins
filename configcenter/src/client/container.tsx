import { useMemo } from 'react'
import type { CredentialCenterApi } from './api.js'
import { CredentialPanel } from './CredentialPanel.js'
import type { Translate } from './locales.js'
import { useVariables } from './useVariables.js'

export interface CredentialPanelContainerProps {
  readonly api: CredentialCenterApi
  readonly t: (key: string, params?: Record<string, unknown>) => string
}

export function CredentialPanelContainer(props: CredentialPanelContainerProps) {
  const state = useVariables(props.api)
  const t = useMemo<Translate>(() => (key, params) => props.t(key, params), [props.t])
  return <CredentialPanel {...state} t={t} />
}
