/** Single-writer install authority. Upload inspection and command execution stay Host-side. */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute } from 'node:path'
import type { Activation, InstallOperation, InstalledPackage, InstallerSnapshot, PackagePreview } from '../shared/protocol.js'
import { defaultProfileDirectory } from '../../host/profile.js'
import { dshLauncherPath } from './cli.js'
import { listInstalledPackages } from './installed.js'
import { persistTarball } from './artifacts.js'
import { StagingStore } from './staging.js'

const OUTPUT_LIMIT = 96 * 1024
const COMMAND_TIMEOUT_MS = 15 * 60 * 1000
const SAFE_PROFILE = /^[\p{L}\p{M}\p{N}._ -]+$/u
const SAFE_PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i

export interface CommandResult {
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly output: string
}

/** A rejected installer request carrying a stable, wire-facing error code. */
export class InstallerError extends Error {
  constructor(readonly code: 'VALIDATION' | 'BUSY', message: string) {
    super(message)
    this.name = 'InstallerError'
  }
}

export type CommandRunner = (profile: string, tarballPath: string, allowScripts: boolean) => Promise<CommandResult>
export type TarballPersister = (stagedPath: string, preview: PackagePreview) => Promise<string>
export type Activator = (packageName: string) => Promise<Activation>
export type RemoveRunner = (profile: string, packageName: string) => Promise<CommandResult>
export type Deactivator = (packageName: string) => Promise<Activation>
/** Metadata-only audit sink: never pass paths, archive contents, or credentials. */
export type InstallerAudit = (event: string, details: Record<string, string | boolean | number | null>) => void

function quoteCmdArg(value: string): string {
  if (!/[\s"&|<>^()%!]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.unref()
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

/**
 * Run one `dsh plugin …` subcommand of the DSH CLI that launched this host.
 * Arguments are never passed through a shell; the only cmd.exe shim is the
 * PATH-lookup fallback on Windows, where `dsh` is a batch wrapper that
 * cannot be spawned directly.
 */
function runDshCommand(extraArgs: string[]): Promise<CommandResult> {
  const launcher = dshLauncherPath()
  let file: string
  let args: string[]
  let cwd: string | undefined
  let windowsShim = false
  if (launcher !== undefined) {
    file = process.execPath
    args = [...process.execArgv, launcher, ...extraArgs]
    cwd = dirname(launcher)
  } else {
    file = 'dsh'
    args = extraArgs
    windowsShim = process.platform === 'win32'
  }
  if (windowsShim) {
    const command = [file, ...args].map(quoteCmdArg).join(' ')
    file = process.env.ComSpec ?? 'cmd.exe'
    args = ['/d', '/s', '/c', `"${command}"`]
  }
  return new Promise(resolveResult => {
    const child = spawn(file, args, {
      cwd,
      env: { ...process.env, CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: windowsShim,
      detached: process.platform !== 'win32',
    })
    let output = ''
    let timedOut = false
    const append = (chunk: Buffer): void => {
      output = `${output}${chunk.toString()}`.slice(-OUTPUT_LIMIT)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => {
      timedOut = true
      killProcessTree(child)
    }, COMMAND_TIMEOUT_MS)
    timer.unref?.()
    child.on('error', error => {
      clearTimeout(timer)
      resolveResult({ exitCode: 127, timedOut: false, output: `${output}\n${error.message}`.trim() })
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolveResult({ exitCode: code, timedOut, output: output.trim() })
    })
  })
}

/** Install one tarball through DSH's own CLI, never a shell for user-controlled data. */
export function runDshInstall(profile: string, tarballPath: string, allowScripts: boolean): Promise<CommandResult> {
  if (!isAbsolute(tarballPath) || tarballPath.includes('\0')) return Promise.reject(new Error('staged tarball path must be absolute'))
  if (!SAFE_PROFILE.test(profile)) return Promise.reject(new Error(`unsafe profile name: ${JSON.stringify(profile)}`))
  return runDshCommand(['plugin', '--profile', profile, 'add', tarballPath, ...(allowScripts ? [] : ['--ignore-scripts'])])
}

/** Remove exactly one direct profile dependency through DSH's own CLI. */
export function runDshRemove(profile: string, packageName: string): Promise<CommandResult> {
  if (!SAFE_PROFILE.test(profile)) return Promise.reject(new Error(`unsafe profile name: ${JSON.stringify(profile)}`))
  if (!SAFE_PACKAGE.test(packageName)) return Promise.reject(new Error('unsafe package name'))
  return runDshCommand(['plugin', '--profile', profile, 'remove', packageName])
}

export interface InstallerServiceOptions {
  readonly profile: string
  readonly allowInstallScripts: boolean
  readonly maxUploadBytes: number
  readonly profileDirectory?: string
  readonly staging?: StagingStore
  readonly run?: CommandRunner
  readonly remove?: RemoveRunner
  readonly readInstalled?: () => InstalledPackage[]
  readonly persist?: TarballPersister
  readonly activate?: Activator
  readonly deactivate?: Deactivator
  readonly audit?: InstallerAudit
}

export class InstallerService {
  readonly #profile: string
  readonly #allowInstallScripts: boolean
  readonly #maxUploadBytes: number
  readonly #staging: StagingStore
  readonly #run: CommandRunner
  readonly #readInstalled: () => InstalledPackage[]
  readonly #persist: TarballPersister
  readonly #activate: Activator
  readonly #remove: RemoveRunner
  readonly #deactivate: Deactivator
  readonly #audit: InstallerAudit
  #staged: PackagePreview | null = null
  #operation: InstallOperation | null = null
  #disposed = false

  constructor(options: InstallerServiceOptions) {
    this.#profile = options.profile
    this.#allowInstallScripts = options.allowInstallScripts
    this.#maxUploadBytes = options.maxUploadBytes
    this.#staging = options.staging ?? new StagingStore()
    this.#run = options.run ?? runDshInstall
    const profileDirectory = options.profileDirectory ?? defaultProfileDirectory(options.profile)
    this.#readInstalled = options.readInstalled ?? (() => listInstalledPackages(profileDirectory))
    this.#persist = options.persist ?? ((path, preview) => persistTarball(profileDirectory, path, preview))
    this.#activate = options.activate ?? (async () => ({ state: 'restart-required', reasonCode: 'include-unavailable', reason: 'hot mounting is not configured' }))
    this.#remove = options.remove ?? runDshRemove
    this.#deactivate = options.deactivate ?? (async () => ({ state: 'restart-required', reasonCode: 'not-mounted', reason: 'no hot-mounted instance exists in this session' }))
    this.#audit = options.audit ?? (() => {})
  }

  snapshot(): InstallerSnapshot {
    return {
      profile: this.#profile,
      allowInstallScripts: this.#allowInstallScripts,
      maxUploadBytes: this.#maxUploadBytes,
      staged: this.#staged,
      operation: this.#operation,
      packages: this.#readInstalled(),
    }
  }

  isRunning(): boolean {
    return this.#operation?.state === 'running'
  }

  async inspect(bytes: Buffer, fileName: string): Promise<PackagePreview> {
    this.#ensureNotDisposed()
    this.#ensureIdle()
    const preview = await this.#staging.stage(bytes, fileName)
    this.#staged = preview
    this.#audit('plugin.inspect', { name: preview.name, version: preview.version, size: preview.size })
    return preview
  }

  async start(token: string, allowScripts: boolean): Promise<InstallOperation> {
    this.#ensureNotDisposed()
    this.#ensureIdle()
    if (allowScripts && !this.#allowInstallScripts) throw new InstallerError('VALIDATION', 'install scripts are disabled by plugin configuration')
    const staged = await this.#staging.consume(token)
    if (staged === null) throw new InstallerError('VALIDATION', 'staged tarball is missing or expired')
    this.#staged = null
    const started: InstallOperation = {
      id: randomUUID(),
      kind: 'install',
      packageName: staged.preview.name,
      version: staged.preview.version,
      state: 'running',
      startedAt: new Date().toISOString(),
    }
    this.#operation = started
    this.#audit('plugin.install.started', { name: staged.preview.name, version: staged.preview.version, allowScripts })
    void this.#executeInstall(started, staged.path, staged.preview, allowScripts)
    return started
  }

  async remove(packageName: string): Promise<InstallOperation> {
    this.#ensureNotDisposed()
    this.#ensureIdle()
    if (packageName === 'configcenter') throw new InstallerError('VALIDATION', 'configcenter cannot remove itself')
    const installed = this.#readInstalled().find(item => item.name === packageName)
    if (installed === undefined) throw new InstallerError('VALIDATION', 'package is not a direct dependency of this profile')
    const started: InstallOperation = {
      id: randomUUID(),
      kind: 'remove',
      packageName,
      version: installed.version ?? 'unknown',
      state: 'running',
      startedAt: new Date().toISOString(),
    }
    this.#operation = started
    this.#audit('plugin.remove.started', { name: packageName, version: started.version })
    void this.#executeRemove(started)
    return started
  }

  async dispose(): Promise<void> {
    this.#disposed = true
    await this.#staging.dispose()
  }

  #ensureNotDisposed(): void {
    if (this.#disposed) throw new Error('installer is disposed')
  }

  #ensureIdle(): void {
    if (this.#operation?.state === 'running') throw new InstallerError('BUSY', 'an operation is already running')
  }

  async #executeInstall(started: InstallOperation, stagedPath: string, preview: PackagePreview, allowScripts: boolean): Promise<void> {
    try {
      const persistedPath = await this.#persist(stagedPath, preview)
      const result = await this.#run(this.#profile, persistedPath, allowScripts)
      if (this.#operation?.id !== started.id) return
      const activation = this.#succeeded(result) ? await this.#activate(started.packageName) : undefined
      this.#finish(started, result, activation)
    } catch (error) {
      this.#fail(started, error)
    } finally {
      await this.#staging.removePath(stagedPath)
    }
  }

  async #executeRemove(started: InstallOperation): Promise<void> {
    try {
      const result = await this.#remove(this.#profile, started.packageName)
      if (this.#operation?.id !== started.id) return
      const activation = this.#succeeded(result) ? await this.#deactivate(started.packageName) : undefined
      this.#finish(started, result, activation)
    } catch (error) {
      this.#fail(started, error)
    }
  }

  #succeeded(result: CommandResult): boolean {
    return result.exitCode === 0 && !result.timedOut
  }

  #finish(started: InstallOperation, result: CommandResult, activation: Activation | undefined): void {
    const succeeded = this.#succeeded(result)
    this.#operation = {
      ...started,
      state: succeeded ? 'succeeded' : 'failed',
      finishedAt: new Date().toISOString(),
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      output: result.output,
      ...(activation === undefined ? {} : { activation }),
      ...(!succeeded
        ? {
            error: result.timedOut
              ? `${started.kind === 'install' ? 'installation' : 'removal'} timed out`
              : `dsh plugin ${started.kind === 'install' ? 'add' : 'remove'} exited with ${String(result.exitCode)}`,
          }
        : {}),
    }
    this.#audit(`plugin.${started.kind}.finished`, {
      name: started.packageName,
      version: started.version,
      succeeded,
      timedOut: result.timedOut,
      exitCode: result.exitCode,
    })
  }

  #fail(started: InstallOperation, error: unknown): void {
    if (this.#operation?.id !== started.id) return
    this.#operation = {
      ...started,
      state: 'failed',
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }
    this.#audit(`plugin.${started.kind}.failed`, {
      name: started.packageName,
      version: started.version,
      reason: error instanceof Error ? error.name : 'unknown',
    })
  }
}
