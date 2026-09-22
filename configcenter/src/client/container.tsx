import type { CredentialCenterApi } from './api.js'
import { CredentialPanel } from './CredentialPanel.js'
import type { Translate } from './locales.js'
import { useVariables } from './useVariables.js'

export interface CredentialPanelContainerProps {
  readonly api: CredentialCenterApi
  readonly t: Translate
}

/** Wires the credential state machine into the presentational panel. */
export function CredentialPanelContainer({ api, t }: CredentialPanelContainerProps) {
  const state = useVariables(api)
  return <CredentialPanel {...state} t={t} />
}
