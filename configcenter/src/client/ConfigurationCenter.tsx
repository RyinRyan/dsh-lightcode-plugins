import { useState } from 'react'
import type { CredentialCenterApi } from './api.js'
import { CredentialPanelContainer } from './container.js'
import type { InstallerApi } from '../tar-installer/client/api.js'
import { InstallerPanel } from '../tar-installer/client/InstallerPanel.js'

type Tab = 'credentials' | 'plugins'
export interface ConfigurationCenterProps { readonly credentialsApi: CredentialCenterApi; readonly installerApi: InstallerApi; readonly installerT: (key: string, params?: Record<string, unknown>) => string; readonly t: (key: string, params?: Record<string, unknown>) => string }
export function ConfigurationCenter(props: ConfigurationCenterProps) {
  const [tab, setTab] = useState<Tab>('credentials')
  return <section className="dsh-config-center" aria-label={props.t('panel.title')}><header className="dsh-config-center__header"><div><h1>{props.t('panel.title')}</h1><p>{props.t('panel.subtitle')}</p></div><div className="dsh-config-center__tabs" role="tablist" aria-label={props.t('panel.title')}><button type="button" role="tab" aria-selected={tab === 'credentials'} className={tab === 'credentials' ? 'active' : ''} onClick={() => setTab('credentials')}>{props.t('tabs.credentials')}</button><button type="button" role="tab" aria-selected={tab === 'plugins'} className={tab === 'plugins' ? 'active' : ''} onClick={() => setTab('plugins')}>{props.t('tabs.plugins')}</button></div></header><div className="dsh-config-center__content" role="tabpanel">{tab === 'credentials' ? <CredentialPanelContainer api={props.credentialsApi} t={props.t} /> : <InstallerPanel api={props.installerApi} t={props.installerT} />}</div></section>
}
