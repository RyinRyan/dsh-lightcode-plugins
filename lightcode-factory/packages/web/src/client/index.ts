/** Browser plugin registrations for the workflow board. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from 'lightcode-factory-runtime/client'
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

/** Register the board as a global panel once its target slots are declared. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lightcode-factory-web: dictionaries')
  const label = ctx.locale.bind(NS)('icon.label')
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: (): FactoryWebInjected => ({
      hooks: { factorySnapshot: ctx.lightcodeFactoryClient.state },
      refresh: () => ctx.lightcodeFactoryClient.refresh(),
      loadMore: () => ctx.lightcodeFactoryClient.loadMore(),
      getRun: runId => ctx.lightcodeFactoryClient.getRun(runId),
      start: (workflowId, input) => ctx.lightcodeFactoryClient.start(workflowId, input),
      cancel: runId => ctx.lightcodeFactoryClient.cancel(runId),
      review: (runId, decision) => ctx.lightcodeFactoryClient.review(runId, decision),
    }),
  }, FactoryBoard))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 15, label, locale: NS }, FactoryIcon))
}
