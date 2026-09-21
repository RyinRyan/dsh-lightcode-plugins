/** Built-in Workflow Catalog. Each workflow keeps its implementation in a workflow-id directory. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from 'lightcode-factory-contracts/workflow'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-subprocess'
import {
  createMorningScriptDemoWorkflow, morningScriptDemoConfig, type MorningScriptDemoConfig,
} from './catalog/morning-script-demo/index.ts'
import { releaseReadinessWorkflow } from './catalog/release-readiness/index.ts'

export interface Config extends MorningScriptDemoConfig {
  /** Register the model-and-subprocess demo when its host capabilities are available. */
  demoEnabled?: boolean
}

export const Config: z<Config> = z.intersect([
  morningScriptDemoConfig,
  z.object({ demoEnabled: z.boolean().default(true) }),
])

export const name = 'lightcode-factory-workflows'
export const inject = ['lightcodeFactoryRuntime']

export function apply(ctx: Context, config: Config): void {
  ctx.effect(
    () => ctx.lightcodeFactoryRuntime.registerWorkflow(releaseReadinessWorkflow),
    'catalog: register release-readiness',
  )
  if (config.demoEnabled === false) return
  void ctx.inject(['agents', 'agentDefaultModel', 'sandbox', 'sandboxPolicy', 'subprocess'], (bound) => {
    bound.effect(
      () => bound.lightcodeFactoryRuntime.registerWorkflow(createMorningScriptDemoWorkflow(bound, config)),
      'catalog: register morning-script-demo',
    )
  })
}

export { releaseReadinessWorkflow } from './catalog/release-readiness/index.ts'
export { createMorningScriptDemoWorkflow } from './catalog/morning-script-demo/index.ts'
export default { name, inject, Config, apply }
