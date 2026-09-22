/** Self-service restart: relaunch this exact DSH invocation once its port is free. */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import inspector from 'node:inspector'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import { dshLauncherPath, nodeExecutable } from './cli.js'

export interface RestartResult {
  readonly pid: number
  readonly helperPid?: number
  readonly logFile: string
}

/** Stable reasons a restart may be refused; the browser translates these. */
export type RestartDisabledReason = 'restart-disabled' | 'debugger-active'

export function restartDisabledReason(allowRestart: boolean): RestartDisabledReason | null {
  if (!allowRestart) return 'restart-disabled'
  if (inspector.url() !== undefined || process.execArgv.some(value => value.startsWith('--inspect'))) {
    return 'debugger-active'
  }
  return null
}

/** Restart is only for same-origin requests from the loopback interface. */
export function trustedRestartRequest(request: {
  readonly headers: IncomingMessage['headers']
  readonly remoteAddress: string | undefined
}): boolean {
  const address = request.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  if (request.headers.forwarded !== undefined || request.headers['x-forwarded-for'] !== undefined || request.headers['x-real-ip'] !== undefined) return false
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Extract the serving port from the Host header, if it carries one. */
export function servingPort(request: { readonly headers: IncomingMessage['headers'] }): number | null {
  const host = request.headers.host
  const match = host === undefined ? null : /:(\d{1,5})$/.exec(host)
  const port = match === null ? Number.NaN : Number(match[1])
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** The exact command line to relaunch, including the original CLI arguments. */
function currentInvocation(): { file: string; args: string[]; cwd: string } {
  const launcher = dshLauncherPath()
  if (launcher !== undefined) {
    return { file: nodeExecutable(), args: [...process.execArgv, launcher, ...process.argv.slice(2)], cwd: dirname(launcher) }
  }
  return { file: 'dsh', args: process.argv.slice(2), cwd: process.cwd() }
}

/**
 * Source of the detached helper process: poll until the old port is free,
 * then spawn the relaunch with output appended to a log file.
 */
function restartHelperSource(command: { file: string; args: string[]; detached: boolean }, cwd: string, port: number | null, logFile: string): string {
  return [
    "const { spawn } = require('node:child_process')",
    "const net = require('node:net')",
    "const fs = require('node:fs')",
    `const command = ${JSON.stringify(command)}`,
    `const cwd = ${JSON.stringify(cwd)}`,
    `const port = ${JSON.stringify(port)}`,
    `const logFile = ${JSON.stringify(logFile)}`,
    'const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))',
    'const listening = () => new Promise(resolve => {',
    '  const socket = net.connect({ host: "127.0.0.1", port })',
    '  const done = value => { socket.destroy(); resolve(value) }',
    '  socket.on("connect", () => done(true))',
    '  socket.on("error", () => done(false))',
    '  setTimeout(() => done(false), 400)',
    '})',
    "fs.appendFileSync(logFile, '[configcenter] restart helper started\\n')",
    '(async () => {',
    '  if (port) {',
    '    const limit = Date.now() + 30000',
    '    while (Date.now() < limit && await listening()) await sleep(250)',
    '    await sleep(300)',
    '  } else {',
    '    await sleep(1200)',
    '  }',
    '  try {',
    '    const log = fs.openSync(logFile, "a")',
    '    const child = spawn(command.file, command.args, { cwd, detached: command.detached, stdio: ["ignore", log, log], windowsHide: true })',
    '    child.on("error", error => fs.appendFileSync(logFile, String(error) + "\\n"))',
    '    child.unref()',
    '  } catch (error) {',
    '    fs.appendFileSync(logFile, String(error) + "\\n")',
    '  }',
    '})()',
  ].join('\n')
}

/**
 * Schedule the restart: write the helper, launch it detached, then terminate
 * this process so the port is released for the relaunch.
 */
export function scheduleRestart(port: number | null): RestartResult {
  const current = currentInvocation()
  const command = process.platform === 'win32'
    ? {
        file: 'powershell.exe',
        args: ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', [`& ${quotePowerShell(current.file)}`, ...current.args.map(quotePowerShell)].join(' ')],
        detached: false,
      }
    : { file: current.file, args: current.args, detached: true }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const logFile = join(tmpdir(), `dsh-configcenter-restart-${stamp}.log`)
  const helperFile = join(tmpdir(), `dsh-configcenter-restart-${stamp}.cjs`)
  writeFileSync(helperFile, restartHelperSource(command, current.cwd, port, logFile), { encoding: 'utf8', mode: 0o600 })
  const child = spawn(nodeExecutable(), [helperFile], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env })
  child.once('error', error => {
    try {
      writeFileSync(logFile, String(error), { flag: 'a' })
    } catch { /* the log is best-effort */ }
  })
  child.unref()
  setTimeout(() => process.kill(process.pid, 'SIGTERM'), 500).unref()
  return { pid: process.pid, helperPid: child.pid, logFile }
}
