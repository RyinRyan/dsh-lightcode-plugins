/** Host entry for the unified DSH configuration center. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { registerCredentialCenterRoutes } from './host/routes.js'
import { VariableStore, defaultDataDir } from './host/store.js'
import { InstallerService } from './tar-installer/host/installer.js'
import { registerInstallerRoutes } from './tar-installer/host/routes.js'
import { cleanHotInputs, hotMount, type HotContext } from './tar-installer/host/hot.js'
import { defaultProfileDirectory } from './tar-installer/host/installed.js'

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

export const Config: z<Config> = z.object({ dataDir: z.string(), profile: z.string(), maxUploadMiB: z.natural().min(1).max(512).default(128), allowInstallScripts: z.boolean().default(false), allowRestart: z.boolean().default(true) })

interface ProfileContextLike { readonly name?: unknown; readonly dir?: unknown }
function argvProfile(): string | undefined { const at = process.argv.indexOf('--profile'); return at >= 0 && typeof process.argv[at + 1] === 'string' ? process.argv[at + 1] : undefined }

/** Mount the persistent store, consumer service, and browser routes. */
export function apply(ctx: Context, config: Config): void {
  const store = new VariableStore({ dataDir: config.dataDir ?? defaultDataDir() })
  const profileContext = ctx.get('profileContext') as ProfileContextLike | undefined
  const profile = config.profile ?? (typeof profileContext?.name === 'string' ? profileContext.name : undefined) ?? argvProfile() ?? 'web'
  const profileDirectory = (typeof profileContext?.dir === 'string' && !profileContext.dir.includes('\0') ? profileContext.dir : undefined) ?? defaultProfileDirectory(profile)
  const installer = new InstallerService({ profile, profileDirectory, maxUploadBytes: (config.maxUploadMiB ?? 128) * 1024 * 1024, allowInstallScripts: config.allowInstallScripts ?? false, activate: packageName => hotMount(ctx as unknown as HotContext, profileDirectory, packageName), audit: (event, details) => ctx.logger.info(`[configcenter] ${event} ${JSON.stringify(details)}`) })
  void cleanHotInputs(profileDirectory).catch(error => ctx.logger.warn(new Error(`configcenter: hot-input cleanup failed: ${error instanceof Error ? error.message : String(error)}`)))
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
        const disposeCredentialRoutes = disposeRoutes
        const disposeInstallerRoutes = registerInstallerRoutes(ctx, installer, { allowRestart: config.allowRestart ?? true })
        disposeRoutes = () => { disposeCredentialRoutes?.(); disposeInstallerRoutes() }
      },
      error => {
        ctx.logger.error(new Error(`configcenter: credential store load failed: ${error instanceof Error ? error.message : String(error)}`))
      },
    )
    return async () => {
      disposed = true
      disposeRoutes?.()
      disposeService?.()
      await installer.dispose()
      await store.dispose()
    }
  }, 'dsh-configuration-center: credentials, installer, and routes')
}
