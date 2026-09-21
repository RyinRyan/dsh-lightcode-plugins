import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { InstallerService } from './host/installer.js'
import { registerInstallerRoutes } from './host/routes.js'
import { cleanHotInputs, hotMount, type HotContext } from './host/hot.js'
import { defaultProfileDirectory } from './host/installed.js'

export const name = 'dsh-tar-installer'
export const inject = ['webServer', 'loader']

export interface Config {
  profile?: string
  maxUploadMiB?: number
  allowInstallScripts?: boolean
  allowRestart?: boolean
}

export const Config: z<Config> = z.object({
  profile: z.string(),
  maxUploadMiB: z.natural().min(1).max(512).default(128),
  allowInstallScripts: z.boolean().default(false),
  allowRestart: z.boolean().default(true),
})

interface ProfileContextLike { readonly name?: unknown; readonly dir?: unknown }

function argvProfile(): string | undefined {
  const at = process.argv.indexOf('--profile')
  return at >= 0 && typeof process.argv[at + 1] === 'string' ? process.argv[at + 1] : undefined
}

/** Mount the installer against the profile serving this page. */
export function apply(ctx: Context, config: Config): void {
  const profileContext = ctx.get('profileContext') as ProfileContextLike | undefined
  const reported = typeof profileContext?.name === 'string' ? profileContext.name : undefined
  const profile = config.profile ?? reported ?? argvProfile() ?? 'web'
  const profileDirectory = typeof profileContext?.dir === 'string' && !profileContext.dir.includes('\0') ? profileContext.dir : undefined
  const activeProfileDirectory = profileDirectory ?? defaultProfileDirectory(profile)
  const hotContext = ctx as unknown as HotContext
  void cleanHotInputs(activeProfileDirectory).catch(() => {})
  const service = new InstallerService({
    profile,
    profileDirectory: activeProfileDirectory,
    maxUploadBytes: (config.maxUploadMiB ?? 128) * 1024 * 1024,
    allowInstallScripts: config.allowInstallScripts ?? false,
    activate: packageName => hotMount(hotContext, activeProfileDirectory, packageName),
  })
  ctx.effect(() => {
    const disposeRoutes = registerInstallerRoutes(ctx, service, { allowRestart: config.allowRestart ?? true })
    return async () => {
      disposeRoutes()
      await service.dispose()
    }
  }, 'dsh-tar-installer: staging, install runner and routes')
}
