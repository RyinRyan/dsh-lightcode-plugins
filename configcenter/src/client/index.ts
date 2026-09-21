/** Browser entry: locale, sidebar row, and main credential-center panel. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createCredentialCenterApi } from './api.js'
import { CredentialPanelContainer } from './container.js'
import { ConfigurationCenter } from './ConfigurationCenter.js'
import { createInstallerApi } from '../tar-installer/client/api.js'
import { dictionaries as installerDictionaries, NS as INSTALLER_NS } from '../tar-installer/client/locales.js'
import { NS, dictionaries } from './locales.js'
import { PanelIcon } from './PanelIcon.js'
import { injectStyles } from './styles.js'
import { injectStyles as injectInstallerStyles } from '../tar-installer/client/styles.js'

export const name = 'configcenter/client'
export const inject = ['slots', 'locale']
export const PANEL_ID = 'configuration-center'
const PANEL_ORDER = 38

export function apply(ctx: Context): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-configuration-center: credential dictionaries')
    ctx.effect(() => ctx.locale.register(INSTALLER_NS, installerDictionaries), 'dsh-configuration-center: installer dictionaries')
    ctx.effect(() => injectStyles(), 'dsh-configuration-center: styles')
    ctx.effect(() => injectInstallerStyles(), 'configcenter: plugin-manager styles')
    const t = ctx.locale.bind(NS)
    const credentialsApi = createCredentialCenterApi()
    const installerApi = createInstallerApi()
    const installerT = ctx.locale.bind(INSTALLER_NS)
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => t('panel.label') }, PanelIcon))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ credentialsApi, installerApi, installerT }) }, ConfigurationCenter))
  } catch (error) {
    console.error('[dsh-configuration-center] client half failed to start:', error)
  }
}
