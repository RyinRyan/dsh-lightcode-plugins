/** Browser entry: locale, sidebar row, and main credential-center panel. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createCredentialCenterApi } from './api.js'
import { CredentialPanelContainer } from './container.js'
import { NS, dictionaries } from './locales.js'
import { PanelIcon } from './PanelIcon.js'
import { injectStyles } from './styles.js'

export const name = 'dsh-credential-center/client'
export const inject = ['slots', 'locale']
export const PANEL_ID = 'credential-center'
const PANEL_ORDER = 38

export function apply(ctx: Context): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-credential-center: dictionaries')
    ctx.effect(() => injectStyles(), 'dsh-credential-center: styles')
    const t = ctx.locale.bind(NS)
    const api = createCredentialCenterApi()
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => t('panel.label') }, PanelIcon))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ api }) }, CredentialPanelContainer))
  } catch (error) {
    console.error('[dsh-credential-center] client half failed to start:', error)
  }
}
