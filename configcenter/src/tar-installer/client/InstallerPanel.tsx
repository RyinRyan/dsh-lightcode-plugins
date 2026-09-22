import { useEffect, useRef, useState } from 'react'
import type { InstallerApi } from './api.js'
import type { Activation, ActivationReasonCode, InstallOperation, InstalledPackage, InstallerSnapshot, PackagePreview } from '../shared/protocol.js'
import { ApiClientError } from '../../client/http.js'
import type { MessageKey, Translate } from '../../client/locales.js'

function bytes(value: number): string {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / 1024 / 1024).toFixed(1)} MiB`
}

/** Stable activation reasons mapped to translatable message keys. */
const ACTIVATION_KEYS: Record<ActivationReasonCode, MessageKey> = {
  'include-unavailable': 'installer.activation.include-unavailable',
  'patch-missing': 'installer.activation.patch-missing',
  'patch-unsupported': 'installer.activation.patch-unsupported',
  'mount-failed': 'installer.activation.mount-failed',
  'not-mounted': 'installer.activation.not-mounted',
}

/** Stable API error reasons/codes mapped to translatable message keys. */
const API_ERROR_KEYS: Record<string, MessageKey> = {
  'restart-disabled': 'installer.restart.disabled',
  'debugger-active': 'installer.restart.debugger',
  RESTART_DISABLED: 'installer.restart.disabled',
  ORIGIN: 'installer.restart.origin',
}

/** Localize known API failures; unknown ones surface their raw message. */
function errorText(t: Translate, error: unknown): string {
  if (error instanceof ApiClientError) {
    const key = API_ERROR_KEYS[error.reasonCode ?? ''] ?? API_ERROR_KEYS[error.code]
    if (key !== undefined) return t(key)
  }
  return error instanceof Error ? error.message : String(error)
}

/** Compose the post-operation hint from the activation outcome. */
function activationText(t: Translate, kind: InstallOperation['kind'], activation: Activation | undefined): string {
  if (activation === undefined) return ''
  if (activation.state === 'live') {
    return t(kind === 'remove' ? 'installer.remove.live' : 'installer.live')
  }
  const key = activation.reasonCode === undefined ? undefined : ACTIVATION_KEYS[activation.reasonCode]
  if (key !== undefined) {
    const detail = activation.reasonCode === 'mount-failed' && activation.reason !== undefined ? `：${activation.reason}` : ''
    return `${t('installer.restart.needed')} ${t(key)}${detail}`
  }
  return activation.reason !== undefined
    ? `${t('installer.restart.needed')}${activation.reason}`
    : t('installer.restart.needed')
}

export interface InstallerPanelProps {
  readonly api: InstallerApi
  readonly t: Translate
}

export function InstallerPanel({ api, t }: InstallerPanelProps) {
  const input = useRef<HTMLInputElement>(null)
  const [snapshot, setSnapshot] = useState<InstallerSnapshot | null>(null)
  const [preview, setPreview] = useState<PackagePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const [allowScripts, setAllowScripts] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [restarting, setRestarting] = useState(false)

  const refresh = async (): Promise<void> => {
    try {
      setSnapshot(await api.status())
    } catch (cause) {
      setError(errorText(t, cause))
    }
  }

  useEffect(() => { void refresh() }, [])

  useEffect(() => {
    if (snapshot?.operation?.state !== 'running') return
    const timer = window.setInterval(() => { void refresh() }, 900)
    return () => { window.clearInterval(timer) }
  }, [snapshot?.operation?.state])

  const inspect = async (file: File): Promise<void> => {
    setBusy(true)
    setError(null)
    setPreview(null)
    try {
      const next = await api.inspect(file)
      setPreview(next)
      await refresh()
    } catch (cause) {
      setError(errorText(t, cause))
    } finally {
      setBusy(false)
    }
  }

  const install = async (): Promise<void> => {
    if (preview === null) return
    setBusy(true)
    setError(null)
    try {
      await api.install(preview.token, allowScripts)
      setPreview(null)
      await refresh()
    } catch (cause) {
      setError(errorText(t, cause))
    } finally {
      setBusy(false)
    }
  }

  const restart = async (): Promise<void> => {
    if (!window.confirm(t('installer.restart.confirm'))) return
    setRestarting(true)
    setError(null)
    try {
      await api.restart()
    } catch (cause) {
      setRestarting(false)
      setError(errorText(t, cause))
    }
  }

  const remove = async (name: string): Promise<void> => {
    if (!window.confirm(t('installer.remove.confirm', { name }))) return
    setBusy(true)
    setError(null)
    try {
      await api.remove(name)
      await refresh()
    } catch (cause) {
      setError(errorText(t, cause))
    } finally {
      setBusy(false)
    }
  }

  const dismissOperation = (): void => {
    setSnapshot(previous => (previous === null ? previous : { ...previous, operation: null }))
  }

  const operation = snapshot?.operation
  const running = operation?.state === 'running'
  const packages = (snapshot?.packages ?? []).filter(item => item.name.toLowerCase().includes(query.trim().toLowerCase()))
  const packageVersion = (item: InstalledPackage): string => item.version ?? t('installer.installed.unresolved')

  return (
    <main className="dti-root">
      <div className="dti-shell">
        <div className="dti-eyebrow">DSH Plugin Utility</div>
        <div className="dti-title-row">
          <div>
            <h1 className="dti-title">{t('installer.title')}</h1>
            <p className="dti-subtitle">{t('installer.subtitle')}</p>
          </div>
          <button className="dti-button secondary" disabled={restarting || running} onClick={() => { void restart() }}>
            {restarting ? t('installer.restart.pending') : t('installer.restart.action')}
          </button>
        </div>
        {restarting && <div className="dti-alert">{t('installer.restart.reconnecting')}</div>}

        <section className="dti-card">
          {preview === null && !running && (
            <div
              className="dti-drop"
              data-drag={drag}
              onDragOver={event => { event.preventDefault(); setDrag(true) }}
              onDragLeave={() => { setDrag(false) }}
              onDrop={event => {
                event.preventDefault()
                setDrag(false)
                const file = event.dataTransfer.files[0]
                if (file) void inspect(file)
              }}
            >
              <div className="dti-drop-title">
                {busy
                  ? <><span className="dti-spinner" />{t('installer.checking')}</>
                  : t('installer.drop.title')}
              </div>
              <div className="dti-muted">{t('installer.drop.hint')}</div>
              <div className="dti-actions" style={{ justifyContent: 'center' }}>
                <button className="dti-button" disabled={busy} onClick={() => { input.current?.click() }}>{t('installer.select')}</button>
              </div>
              <input
                ref={input}
                className="dti-file"
                type="file"
                accept=".tgz,.tar.gz,application/gzip"
                onChange={event => {
                  const file = event.currentTarget.files?.[0]
                  if (file) void inspect(file)
                }}
              />
            </div>
          )}
          {preview !== null && (
            <>
              <div className="dti-grid">
                <div className="dti-cell"><div className="dti-label">{t('installer.package')}</div><div className="dti-value">{preview.name}</div></div>
                <div className="dti-cell"><div className="dti-label">{t('installer.version')}</div><div className="dti-value">{preview.version}</div></div>
                <div className="dti-cell"><div className="dti-label">{t('installer.size')}</div><div className="dti-value">{bytes(preview.size)}</div></div>
                <div className="dti-cell"><div className="dti-label">{t('installer.profile')}</div><div className="dti-value">{snapshot?.profile ?? 'web'}</div></div>
                <div className="dti-cell" style={{ gridColumn: '1 / -1' }}><div className="dti-label">{t('installer.sha')}</div><div className="dti-value dti-sha">{preview.sha256}</div></div>
              </div>
              <div className="dti-badges">
                <span className={`dti-badge ${preview.hasHost ? '' : 'off'}`}>{t('installer.host')}: {t(preview.hasHost ? 'installer.yes' : 'installer.no')}</span>
                <span className={`dti-badge ${preview.hasClient ? '' : 'off'}`}>{t('installer.client')}: {t(preview.hasClient ? 'installer.yes' : 'installer.no')}</span>
                <span className={`dti-badge ${preview.hasBundlePatch ? '' : 'off'}`}>{t('installer.bundle')}: {t(preview.hasBundlePatch ? 'installer.yes' : 'installer.no')}</span>
              </div>
              {snapshot?.allowInstallScripts
                ? (
                  <label className="dti-check">
                    <input type="checkbox" checked={allowScripts} onChange={event => { setAllowScripts(event.currentTarget.checked) }} />
                    <span>
                      <strong>{t('installer.scripts')}</strong>
                      <br />
                      <span className="dti-muted">{t('installer.scripts.warn')}</span>
                    </span>
                  </label>
                  )
                : <div className="dti-alert">{t('installer.safe')}</div>}
              <div className="dti-actions">
                <button className="dti-button" disabled={busy} onClick={() => { void install() }}>{t('installer.install')}</button>
                <button className="dti-button secondary" disabled={busy} onClick={() => { setPreview(null) }}>{t('installer.retry')}</button>
              </div>
            </>
          )}
          {running && (
            <div className="dti-alert">
              <span className="dti-spinner" />
              {t(operation.kind === 'remove' ? 'installer.removing' : 'installer.installing')} {operation.packageName}@{operation.version}
            </div>
          )}
          {operation?.state === 'succeeded' && preview === null && (
            <>
              <div className="dti-alert">
                <strong>{t(operation.kind === 'remove' ? 'installer.remove.success' : 'installer.success')}</strong>
                <br />
                {activationText(t, operation.kind, operation.activation)}
              </div>
              <div className="dti-actions">
                <button className="dti-button secondary" onClick={dismissOperation}>{t('installer.retry')}</button>
              </div>
            </>
          )}
          {operation?.state === 'failed' && preview === null && (
            <>
              <div className="dti-alert error">
                <strong>{t('installer.failed')}</strong>
                <br />
                {operation.error}
              </div>
              {operation.output !== undefined && (
                <>
                  <div className="dti-label" style={{ marginTop: 18 }}>{t('installer.output')}</div>
                  <pre className="dti-output">{operation.output}</pre>
                </>
              )}
              <div className="dti-actions">
                <button className="dti-button secondary" onClick={dismissOperation}>{t('installer.retry')}</button>
              </div>
            </>
          )}
          {error !== null && <div className="dti-alert error">{error}</div>}
        </section>

        <section className="dti-card dti-installed">
          <div className="dti-section-heading">
            <div>
              <h2>{t('installer.installed.title')}</h2>
              <p>{t('installer.installed.subtitle')}</p>
            </div>
            <button className="dti-button secondary" onClick={() => { void refresh() }}>{t('installer.installed.refresh')}</button>
          </div>
          <input
            className="dti-search"
            value={query}
            onChange={event => { setQuery(event.currentTarget.value) }}
            placeholder={t('installer.installed.search')}
            aria-label={t('installer.installed.search')}
          />
          {snapshot === null
            ? <div className="dti-muted dti-list-state"><span className="dti-spinner" />{t('installer.installed.loading')}</div>
            : packages.length === 0
              ? <div className="dti-muted dti-list-state">{query ? t('installer.installed.noMatch') : t('installer.installed.empty')}</div>
              : (
                <div className="dti-package-list">
                  {packages.map(item => (
                    <article className="dti-package" key={item.name}>
                      <div className="dti-package-main">
                        <strong>{item.name}</strong>
                        {item.description !== undefined && <span>{item.description}</span>}
                      </div>
                      <div className="dti-package-meta">
                        <span>{packageVersion(item)}</span>
                        <span>{t(`installer.source.${item.source}`)}</span>
                        <span className={`dti-package-kind ${item.isDshPlugin ? '' : 'plain'}`}>{t(item.isDshPlugin ? 'installer.installed.plugin' : 'installer.installed.package')}</span>
                        {item.name !== 'configcenter' && (
                          <button className="dti-text-button" disabled={busy || running} onClick={() => { void remove(item.name) }}>{t('installer.remove.action')}</button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
                )}
        </section>
      </div>
    </main>
  )
}
