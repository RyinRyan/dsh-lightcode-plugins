import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { InstallOperation, InstalledPackage, InstallerSnapshot, PackagePreview } from '../shared/protocol.js'
import { defaultProfileDirectory, listInstalledPackages } from './installed.js'
import { persistTarball } from './artifacts.js'
import type { Activation } from './hot.js'
import { StagingStore } from './staging.js'

const OUTPUT_LIMIT = 96 * 1024
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000
const SAFE_PROFILE = /^[\p{L}\p{M}\p{N}._ -]+$/u

export interface CommandResult {
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly output: string
}

export type CommandRunner = (profile: string, tarballPath: string, allowScripts: boolean) => Promise<CommandResult>
export type TarballPersister = (stagedPath: string, preview: PackagePreview) => Promise<string>
export type Activator = (packageName: string) => Promise<Activation>

function quoteCmdArg(value: string): string {
  if (!/[\s"&|<>^()%!]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

function dshInvocation(): { file: string; args: string[]; cwd?: string; windowsShim: boolean } {
  const entry = process.argv[1]
  if (entry !== undefined && /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry)) {
    const absolute = resolve(entry)
    return { file: process.execPath, args: [...process.execArgv, absolute], cwd: dirname(absolute), windowsShim: false }
  }
  return { file: 'dsh', args: [], windowsShim: process.platform === 'win32' }
}

/** Invoke the same DSH CLI that launched this host, never a shell for user-controlled data. */
export function runDshInstall(profile: string, tarballPath: string, allowScripts: boolean): Promise<CommandResult> {
  if (!isAbsolute(tarballPath) || tarballPath.includes('\0')) return Promise.reject(new Error('staged tarball path must be absolute'))
  if (!SAFE_PROFILE.test(profile)) return Promise.reject(new Error(`unsafe profile name: ${JSON.stringify(profile)}`))
  const invocation = dshInvocation()
  const pluginArgs = ['plugin', '--profile', profile, 'add', tarballPath, ...(allowScripts ? [] : ['--ignore-scripts'])]
  let file = invocation.file
  let args = [...invocation.args, ...pluginArgs]
  if (invocation.windowsShim) {
    const comspec = process.env.ComSpec ?? 'cmd.exe'
    const command = [file, ...args].map(quoteCmdArg).join(' ')
    file = comspec
    args = ['/d', '/s', '/c', `"${command}"`]
  }
  return new Promise(resolveResult => {
    const child = spawn(file, args, {
      cwd: invocation.cwd,
      env: { ...process.env, CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsShim,
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
    }, INSTALL_TIMEOUT_MS)
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

function killProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.unref()
    return
  }
  try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
}

/** Single-writer install authority. Upload inspection and command execution stay Host-side. */
export class InstallerService {
  readonly #profile: string
  readonly #allowInstallScripts: boolean
  readonly #maxUploadBytes: number
  readonly #staging: StagingStore
  readonly #run: CommandRunner
  readonly #readInstalled: () => InstalledPackage[]
  readonly #persist: TarballPersister
  readonly #activate: Activator
  #staged: PackagePreview | null = null
  #operation: InstallOperation | null = null
  #disposed = false

  constructor(options: { profile: string; allowInstallScripts: boolean; maxUploadBytes: number; profileDirectory?: string; staging?: StagingStore; run?: CommandRunner; readInstalled?: () => InstalledPackage[]; persist?: TarballPersister; activate?: Activator }) {
    this.#profile = options.profile
    this.#allowInstallScripts = options.allowInstallScripts
    this.#maxUploadBytes = options.maxUploadBytes
    this.#staging = options.staging ?? new StagingStore()
    this.#run = options.run ?? runDshInstall
    const profileDirectory = options.profileDirectory ?? defaultProfileDirectory(options.profile)
    this.#readInstalled = options.readInstalled ?? (() => listInstalledPackages(profileDirectory))
    this.#persist = options.persist ?? ((path, preview) => persistTarball(profileDirectory, path, preview))
    this.#activate = options.activate ?? (async () => ({ state: 'restart-required', reason: '热挂载未配置' }))
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

  isRunning(): boolean { return this.#operation?.state === 'running' }

  async inspect(bytes: Buffer, fileName: string): Promise<PackagePreview> {
    if (this.#disposed) throw new Error('installer is disposed')
    if (this.#operation?.state === 'running') throw new Error('an install is already running')
    const preview = await this.#staging.stage(bytes, fileName)
    this.#staged = preview
    return preview
  }

  async start(token: string, allowScripts: boolean): Promise<InstallOperation> {
    if (this.#disposed) throw new Error('installer is disposed')
    if (this.#operation?.state === 'running') throw new Error('an install is already running')
    if (allowScripts && !this.#allowInstallScripts) throw new Error('install scripts are disabled by plugin configuration')
    const staged = await this.#staging.consume(token)
    if (staged === null) throw new Error('staged tarball is missing or expired')
    this.#staged = null
    const id = randomUUID()
    const started: InstallOperation = {
      id,
      packageName: staged.preview.name,
      version: staged.preview.version,
      state: 'running',
      startedAt: new Date().toISOString(),
    }
    this.#operation = started
    void this.#execute(id, staged.path, staged.preview, started, allowScripts)
    return started
  }

  async #execute(id: string, path: string, preview: PackagePreview, started: InstallOperation, allowScripts: boolean): Promise<void> {
    try {
      const persistedPath = await this.#persist(path, preview)
      const result = await this.#run(this.#profile, persistedPath, allowScripts)
      if (this.#operation?.id !== id) return
      const succeeded = result.exitCode === 0 && !result.timedOut
      const activation = succeeded ? await this.#activate(started.packageName) : undefined
      this.#operation = {
        ...started,
        state: succeeded ? 'succeeded' : 'failed',
        finishedAt: new Date().toISOString(),
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        output: result.output,
        ...(activation === undefined ? {} : { activation }),
        ...(!succeeded ? { error: result.timedOut ? 'installation timed out' : `dsh plugin add exited with ${String(result.exitCode)}` } : {}),
      }
    } catch (error) {
      if (this.#operation?.id === id) {
        this.#operation = {
          ...started,
          state: 'failed',
          finishedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        }
      }
    } finally {
      await this.#staging.removePath(path)
    }
  }

  async dispose(): Promise<void> {
    this.#disposed = true
    await this.#staging.dispose()
  }
}
