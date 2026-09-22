/** Host entry for the unified DSH configuration center. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { registerCredentialCenterRoutes, registerUnavailableRoutes } from './host/routes.js'
import { resolveProfileDirectory, resolveProfileName, type ProfileContextLike } from './host/profile.js'
import { VariableStore, defaultDataDir } from './host/store.js'
import { InstallerService } from './tar-installer/host/installer.js'
import { registerInstallerRoutes } from './tar-installer/host/routes.js'
import { cleanHotInputs, hotMount, hotUnmount, type HotContext } from './tar-installer/host/hot.js'

/** Host-only service consumed by other DSH plugins. */
export interface CredentialVariables {
  /** Return the current value, or `undefined` when the variable is absent. */
  get(name: string): string | undefined
  /** Return the current value or throw a descriptive error when absent. */
  require(name: string): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Variables configured through the configuration center. */
    credentialVariables: CredentialVariables
  }
}

export const name = 'configcenter'
// The installer uses Cordis' standard `ctx.plugin`; requiring a profile-specific
// `loader` service would prevent every Host route from activating in Web profiles.
export const inject = ['webServer']

export interface Config {
  /** Storage directory; defaults to `$DSH_HOME/dsh-credential-center` for compatibility. */
  dataDir?: string
  profile?: string
  maxUploadMiB?: number
  allowInstallScripts?: boolean
  allowRestart?: boolean
}

export const Config: z<Config> = z.object({
  dataDir: z.string(),
  profile: z.string(),
  maxUploadMiB: z.natural().min(1).max(512).default(128),
  allowInstallScripts: z.boolean().default(false),
  allowRestart: z.boolean().default(true),
})

/**
 * Mount the persistent store, the consumer service, and the browser routes.
 * Pure composition: discovery lives in `host/profile.ts`, storage in
 * `host/store.ts`, and the installer in `tar-installer/host/`.
 */
export function apply(ctx: Context, config: Config): void {
  const store = new VariableStore({ dataDir: config.dataDir ?? defaultDataDir() })
  const profileContext = ctx.get('profileContext') as ProfileContextLike | undefined
  const profile = resolveProfileName(config.profile, profileContext)
  const profileDirectory = resolveProfileDirectory(profile, profileContext)
  const installer = new InstallerService({
    profile,
    profileDirectory,
    maxUploadBytes: (config.maxUploadMiB ?? 128) * 1024 * 1024,
    allowInstallScripts: config.allowInstallScripts ?? false,
    activate: packageName => hotMount(ctx as unknown as HotContext, profileDirectory, packageName),
    deactivate: async packageName => (await hotUnmount(packageName)
      ? { state: 'live' }
      : { state: 'restart-required', reasonCode: 'not-mounted', reason: 'the package was not hot-mounted in this session' }),
    audit: (event, details) => ctx.logger.info(`[configcenter] ${event} ${JSON.stringify(details)}`),
  })
  void cleanHotInputs(profileDirectory).catch(error => {
    ctx.logger.warn(new Error(`configcenter: hot-input cleanup failed: ${error instanceof Error ? error.message : String(error)}`))
  })

  let disposers: Array<() => void> = []
  let disposed = false
  const ready = store.load()
  ctx.effect(() => {
    // The installer half does not depend on the credential store.
    disposers.push(registerInstallerRoutes(ctx, installer, { allowRestart: config.allowRestart ?? true }))
    void ready.then(
      () => {
        if (disposed) return
        disposers.push(ctx.provide('credentialVariables', {
          get: name => store.get(name),
          require: name => store.require(name),
        }))
        disposers.push(registerCredentialCenterRoutes(ctx, store))
      },
      error => {
        // Degrade visibly: the panel explains the outage instead of showing a 404.
        if (disposed) return
        const reason = error instanceof Error ? error.message : String(error)
        ctx.logger.error(new Error(`configcenter: credential store load failed: ${reason}`))
        disposers.push(registerUnavailableRoutes(ctx, reason))
      },
    )
    return async () => {
      disposed = true
      for (const dispose of disposers.splice(0)) dispose()
      await installer.dispose()
      await store.dispose()
    }
  }, 'configcenter: credentials, installer, and routes')
}
