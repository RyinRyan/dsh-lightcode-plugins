import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createInstallerApi } from './api.js'
import { InstallerPanel } from './InstallerPanel.js'
import { NS, dictionaries } from './locales.js'
import { PanelIcon } from './PanelIcon.js'
import { injectStyles } from './styles.js'

export const name = 'dsh-tar-installer/client'
export const inject = ['slots', 'locale']
export const PANEL_ID = 'dsh-tar-installer'

export function apply(ctx: Context): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-tar-installer: dictionaries')
    ctx.effect(() => injectStyles(), 'dsh-tar-installer: styles')
    const api = createInstallerApi()
    const t = ctx.locale.bind(NS)
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 45, label: () => t('panel.label') }, PanelIcon))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ api }) }, InstallerPanel))
  } catch (error) {
    console.error('[dsh-tar-installer] client failed to start:', error)
  }
}
