/** Host entry for dsh-credential-center. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { registerCredentialCenterRoutes } from './host/routes.js'
import { VariableStore, defaultDataDir } from './host/store.js'

/** Host-only service consumed by other DSH plugins. */
export interface CredentialVariables {
  /** Return the current value, or `undefined` when the variable is absent. */
  get(name: string): string | undefined
  /** Return the current value or throw a descriptive error when absent. */
  require(name: string): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Variables configured through dsh-credential-center. */
    credentialVariables: CredentialVariables
  }
}

export const name = 'dsh-credential-center'
export const inject = ['webServer']

export interface Config {
  /** Storage directory; defaults to `$DSH_HOME/dsh-credential-center`. */
  dataDir?: string
}

export const Config: z<Config> = z.object({ dataDir: z.string() })

/** Mount the persistent store, consumer service, and browser routes. */
export function apply(ctx: Context, config: Config): void {
  const store = new VariableStore({ dataDir: config.dataDir ?? defaultDataDir() })
  let disposeRoutes: (() => void) | undefined
  let disposeService: (() => void) | undefined
  let disposed = false
  const ready = store.load()
  ctx.effect(() => {
    void ready.then(
      () => {
        if (disposed) return
        const service: CredentialVariables = {
          get: name => store.get(name),
          require: name => store.require(name),
        }
        disposeService = ctx.provide('credentialVariables', service)
        disposeRoutes = registerCredentialCenterRoutes(ctx, store)
      },
      error => {
        ctx.logger.error(new Error(`dsh-credential-center: store load failed: ${error instanceof Error ? error.message : String(error)}`))
      },
    )
    return async () => {
      disposed = true
      disposeRoutes?.()
      disposeService?.()
      await store.dispose()
    }
  }, 'dsh-credential-center: store + service + routes')
}
