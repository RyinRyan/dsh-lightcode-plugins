import { useEffect, useRef, useState } from 'react'
import type { InstallerApi } from './api.js'
import type { Translate } from './locales.js'
import type { InstalledPackage, InstallerSnapshot, PackagePreview } from '../shared/protocol.js'

function bytes(value: number): string {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / 1024 / 1024).toFixed(1)} MiB`
}

export function InstallerPanel({ api, t }: { readonly api: InstallerApi; readonly t: Translate }) {
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
    try { setSnapshot(await api.status()) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    if (snapshot?.operation?.state !== 'running') return
    const timer = window.setInterval(() => { void refresh() }, 900)
    return () => window.clearInterval(timer)
  }, [snapshot?.operation?.state])

  const inspect = async (file: File): Promise<void> => {
    setBusy(true); setError(null); setPreview(null)
    try { const next = await api.inspect(file); setPreview(next); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const install = async (): Promise<void> => {
    if (preview === null) return
    setBusy(true); setError(null)
    try { await api.install(preview.token, allowScripts); setPreview(null); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const restart = async (): Promise<void> => {
    if (!window.confirm(t('restart.confirm'))) return
    setRestarting(true); setError(null)
    try { await api.restart() }
    catch (cause) { setRestarting(false); setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const operation = snapshot?.operation
  const running = operation?.state === 'running'
  const packages = (snapshot?.packages ?? []).filter(item => item.name.toLowerCase().includes(query.trim().toLowerCase()))
  const packageVersion = (item: InstalledPackage): string => item.version ?? t('installed.unresolved')

  return <main className="dti-root"><div className="dti-shell">
    <div className="dti-eyebrow">DSH Plugin Utility</div>
    <div className="dti-title-row"><div><h1 className="dti-title">{t('title')}</h1><p className="dti-subtitle">{t('subtitle')}</p></div><button className="dti-button secondary" disabled={restarting || running} onClick={() => void restart()}>{restarting ? t('restart.pending') : t('restart.action')}</button></div>
    {restarting && <div className="dti-alert">{t('restart.reconnecting')}</div>}
    <section className="dti-card">
      {preview === null && !running && <div className="dti-drop" data-drag={drag}
        onDragOver={event => { event.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={event => { event.preventDefault(); setDrag(false); const file = event.dataTransfer.files[0]; if (file) void inspect(file) }}>
        <div className="dti-drop-title">{busy ? <><span className="dti-spinner"/>{t('checking')}</> : t('drop.title')}</div>
        <div className="dti-muted">{t('drop.hint')}</div>
        <div className="dti-actions" style={{ justifyContent: 'center' }}><button className="dti-button" disabled={busy} onClick={() => input.current?.click()}>{t('select')}</button></div>
        <input ref={input} className="dti-file" type="file" accept=".tgz,.tar.gz,application/gzip" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void inspect(file) }}/>
      </div>}
      {preview !== null && <>
        <div className="dti-grid">
          <div className="dti-cell"><div className="dti-label">{t('package')}</div><div className="dti-value">{preview.name}</div></div>
          <div className="dti-cell"><div className="dti-label">{t('version')}</div><div className="dti-value">{preview.version}</div></div>
          <div className="dti-cell"><div className="dti-label">{t('size')}</div><div className="dti-value">{bytes(preview.size)}</div></div>
          <div className="dti-cell"><div className="dti-label">{t('profile')}</div><div className="dti-value">{snapshot?.profile ?? 'web'}</div></div>
          <div className="dti-cell" style={{ gridColumn: '1 / -1' }}><div className="dti-label">{t('sha')}</div><div className="dti-value dti-sha">{preview.sha256}</div></div>
        </div>
        <div className="dti-badges"><span className={`dti-badge ${preview.hasHost ? '' : 'off'}`}>{t('host')}: {t(preview.hasHost ? 'yes' : 'no')}</span><span className={`dti-badge ${preview.hasClient ? '' : 'off'}`}>{t('client')}: {t(preview.hasClient ? 'yes' : 'no')}</span><span className={`dti-badge ${preview.hasBundlePatch ? '' : 'off'}`}>{t('bundle')}: {t(preview.hasBundlePatch ? 'yes' : 'no')}</span></div>
        {snapshot?.allowInstallScripts ? <label className="dti-check"><input type="checkbox" checked={allowScripts} onChange={e => setAllowScripts(e.currentTarget.checked)}/><span><strong>{t('scripts')}</strong><br/><span className="dti-muted">{t('scripts.warn')}</span></span></label> : <div className="dti-alert">{t('safe')}</div>}
        <div className="dti-actions"><button className="dti-button" disabled={busy} onClick={() => void install()}>{t('install')}</button><button className="dti-button secondary" disabled={busy} onClick={() => setPreview(null)}>{t('retry')}</button></div>
      </>}
      {running && <div className="dti-alert"><span className="dti-spinner"/>{t('installing')} {operation.packageName}@{operation.version}</div>}
      {operation?.state === 'succeeded' && preview === null && <><div className="dti-alert"><strong>{t('success')}</strong><br/>{operation.activation?.state === 'live' ? t('live') : <>{t('restart')}{operation.activation?.reason && `：${operation.activation.reason}`}</>}</div><div className="dti-actions"><button className="dti-button secondary" onClick={() => setSnapshot({ ...snapshot!, operation: null })}>{t('retry')}</button></div></>}
      {operation?.state === 'failed' && preview === null && <><div className="dti-alert error"><strong>{t('failed')}</strong><br/>{operation.error}</div>{operation.output && <><div className="dti-label" style={{ marginTop: 18 }}>{t('output')}</div><pre className="dti-output">{operation.output}</pre></>}<div className="dti-actions"><button className="dti-button secondary" onClick={() => setSnapshot({ ...snapshot!, operation: null })}>{t('retry')}</button></div></>}
      {error && <div className="dti-alert error">{error}</div>}
    </section>
    <section className="dti-card dti-installed">
      <div className="dti-section-heading"><div><h2>{t('installed.title')}</h2><p>{t('installed.subtitle')}</p></div><button className="dti-button secondary" onClick={() => void refresh()}>{t('installed.refresh')}</button></div>
      <input className="dti-search" value={query} onChange={event => setQuery(event.currentTarget.value)} placeholder={t('installed.search')} aria-label={t('installed.search')}/>
      {snapshot === null ? <div className="dti-muted dti-list-state"><span className="dti-spinner"/>{t('installed.loading')}</div> : packages.length === 0 ? <div className="dti-muted dti-list-state">{query ? t('installed.noMatch') : t('installed.empty')}</div> : <div className="dti-package-list">
        {packages.map(item => <article className="dti-package" key={item.name}><div className="dti-package-main"><strong>{item.name}</strong>{item.description && <span>{item.description}</span>}</div><div className="dti-package-meta"><span>{packageVersion(item)}</span><span>{t(`source.${item.source}`)}</span><span className={`dti-package-kind ${item.isDshPlugin ? '' : 'plain'}`}>{t(item.isDshPlugin ? 'installed.plugin' : 'installed.package')}</span></div></article>)}
      </div>}
    </section>
  </div></main>
}
