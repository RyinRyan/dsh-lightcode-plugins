import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import inspector from 'node:inspector'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { IncomingMessage } from 'node:http'

export interface RestartResult { readonly pid: number; readonly helperPid?: number; readonly logFile: string }
function quotePowerShell(value: string): string { return `'${value.replace(/'/g, "''")}'` }
function nodeExecutable(): string { return process.argv0 !== '' && isAbsolute(process.argv0) && existsSync(process.argv0) ? process.argv0 : process.execPath }
function launch(): { file: string; args: string[]; cwd: string } {
  const entry = process.argv[1]
  if (entry !== undefined && /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry)) {
    const absolute = resolve(entry)
    return { file: nodeExecutable(), args: [...process.execArgv, absolute, ...process.argv.slice(2)], cwd: dirname(absolute) }
  }
  return { file: 'dsh', args: process.argv.slice(2), cwd: process.cwd() }
}
export function restartDisabledReason(allowRestart: boolean): string | null {
  if (!allowRestart) return '此 Profile 已禁用自助重启'
  if (inspector.url() !== undefined || process.execArgv.some(value => value.startsWith('--inspect'))) return '调试器运行期间禁止自助重启'
  return null
}
export function trustedRestartRequest(request: Pick<IncomingMessage, 'headers' | 'socket'>): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  if (request.headers.forwarded !== undefined || request.headers['x-forwarded-for'] !== undefined || request.headers['x-real-ip'] !== undefined) return false
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try { return new URL(origin).host === host } catch { return false }
}
export function servingPort(request: Pick<IncomingMessage, 'headers'>): number | null {
  const host = request.headers.host
  const match = host === undefined ? null : /:(\d{1,5})$/.exec(host)
  const port = match === null ? Number.NaN : Number(match[1])
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}
/** Relaunch this exact DSH invocation after the current listener has released its port. */
export function scheduleRestart(port: number | null): RestartResult {
  const current = launch()
  const command = process.platform === 'win32'
    ? { file: 'powershell.exe', args: ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', [`& ${quotePowerShell(current.file)}`, ...current.args.map(quotePowerShell)].join(' ')], detached: false }
    : { file: current.file, args: current.args, detached: true }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const logFile = join(tmpdir(), `dsh-tar-installer-restart-${stamp}.log`)
  const helperFile = join(tmpdir(), `dsh-tar-installer-restart-${stamp}.cjs`)
  const helper = [
    "const { spawn } = require('node:child_process')", "const net = require('node:net')", "const fs = require('node:fs')",
    `const command = ${JSON.stringify(command)}`, `const cwd = ${JSON.stringify(current.cwd)}`, `const port = ${JSON.stringify(port)}`, `const logFile = ${JSON.stringify(logFile)}`,
    'const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))',
    'const listening = () => new Promise(resolve => { const socket = net.connect({ host: "127.0.0.1", port }); const done = value => { socket.destroy(); resolve(value) }; socket.on("connect", () => done(true)); socket.on("error", () => done(false)); setTimeout(() => done(false), 400) })',
    "fs.appendFileSync(logFile, '[dsh-tar-installer] restart helper started\\n')",
    '(async () => { if (port) { const limit = Date.now() + 30000; while (Date.now() < limit && await listening()) await sleep(250); await sleep(300) } else await sleep(1200); try { const log = fs.openSync(logFile, "a"); const child = spawn(command.file, command.args, { cwd, detached: command.detached, stdio: ["ignore", log, log], windowsHide: true }); child.on("error", error => fs.appendFileSync(logFile, String(error) + "\\n")); child.unref() } catch (error) { fs.appendFileSync(logFile, String(error) + "\\n") } })()',
  ].join('\n')
  writeFileSync(helperFile, helper, { encoding: 'utf8', mode: 0o600 })
  const child = spawn(nodeExecutable(), [helperFile], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env })
  child.once('error', error => { try { writeFileSync(logFile, String(error), { flag: 'a' }) } catch {} })
  child.unref()
  setTimeout(() => process.kill(process.pid, 'SIGTERM'), 500).unref()
  return { pid: process.pid, helperPid: child.pid, logFile }
}
