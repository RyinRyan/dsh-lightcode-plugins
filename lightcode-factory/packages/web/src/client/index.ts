/** Browser plugin registrations for the workflow board. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from 'lightcode-factory-runtime/client'
import type { ILightcodeFactoryClient } from 'lightcode-factory-runtime/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { FactoryBoard, FactoryIcon, type FactoryWebInjected } from './FactoryBoard.tsx'
import { en, NS, type FactoryLocaleKey, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { factory: FactoryLocaleKey } }
const PANEL_ID = 'lightcode-factory' as MainPanelId
export const name = 'lightcode-factory-web'
export const inject = ['slots', 'locale', 'lightcodeFactoryClient']

/** Keep all command arguments intact when the slot adapts the browser client. */
export function createFactoryWebInjected(client: ILightcodeFactoryClient): FactoryWebInjected {
  return {
    hooks: { factorySnapshot: client.state },
    refresh: () => client.refresh(),
    loadMore: () => client.loadMore(),
    getRun: runId => client.getRun(runId),
    start: (workflowId, input, scheduledFor) => client.start(workflowId, input, scheduledFor),
    cancel: runId => client.cancel(runId),
    review: (runId, decision) => client.review(runId, decision),
  }
}

/** Register the board as a global panel once its target slots are declared. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lightcode-factory-web: dictionaries')
  const label = ctx.locale.bind(NS)('icon.label')
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: (): FactoryWebInjected => createFactoryWebInjected(ctx.lightcodeFactoryClient),
  }, FactoryBoard))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 15, label, locale: NS }, FactoryIcon))
}
