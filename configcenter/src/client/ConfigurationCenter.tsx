import { useState } from 'react'
import type { CredentialCenterApi } from './api.js'
import type { Translate } from './locales.js'
import { CredentialPanelContainer } from './container.js'
import type { InstallerApi } from '../tar-installer/client/api.js'
import { InstallerPanel } from '../tar-installer/client/InstallerPanel.js'

type Tab = 'credentials' | 'plugins'

export interface ConfigurationCenterProps {
  readonly credentialsApi: CredentialCenterApi
  readonly installerApi: InstallerApi
  readonly t: Translate
}

/** Top-level shell: one sidebar panel hosting the credential and plugin tabs. */
export function ConfigurationCenter({ credentialsApi, installerApi, t }: ConfigurationCenterProps) {
  const [tab, setTab] = useState<Tab>('credentials')
  return (
    <section className="dsh-config-center" aria-label={t('panel.title')}>
      <header className="dsh-config-center__header">
        <div>
          <h1>{t('panel.title')}</h1>
          <p>{t('panel.subtitle')}</p>
        </div>
        <div className="dsh-config-center__tabs" role="tablist" aria-label={t('panel.title')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'credentials'}
            className={tab === 'credentials' ? 'active' : ''}
            onClick={() => { setTab('credentials') }}
          >
            {t('tabs.credentials')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'plugins'}
            className={tab === 'plugins' ? 'active' : ''}
            onClick={() => { setTab('plugins') }}
          >
            {t('tabs.plugins')}
          </button>
        </div>
      </header>
      <div className="dsh-config-center__content" role="tabpanel">
        {tab === 'credentials'
          ? <CredentialPanelContainer api={credentialsApi} t={t} />
          : <InstallerPanel api={installerApi} t={t} />}
      </div>
    </section>
  )
}
