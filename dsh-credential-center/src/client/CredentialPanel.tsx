/** Main credential-center page. */
import { useMemo, useState } from 'react'
import { isVariableName, type SaveVariableInput, type VariableView } from '../shared/protocol.js'
import type { Translate } from './locales.js'
import type { VariablePanelCommands, VariablePanelState } from './useVariables.js'

export interface CredentialPanelProps extends VariablePanelState, VariablePanelCommands {
  readonly t: Translate
}

interface EditorState {
  readonly original: VariableView | null
  readonly name: string
  readonly description: string
  readonly value: string
}

function relativeTime(iso: string): string {
  const elapsed = Date.now() - Date.parse(iso)
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return '刚刚'
  const hours = Math.floor(elapsed / 3_600_000)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

function EditIcon() {
  return <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m13.8 3.2 3 3L7 16l-4 .8.8-4Z" /><path d="m11.8 5.2 3 3" /></svg>
}

function TrashIcon() {
  return <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M3 5h14M8 2.8h4M5.5 5l.7 12h7.6l.7-12M8 8v6M12 8v6" /></svg>
}

export function CredentialPanel(props: CredentialPanelProps) {
  const { t, phase, snapshot, pending, errorText } = props
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const variables = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const all = snapshot?.variables ?? []
    return needle.length === 0 ? all : all.filter(variable =>
      variable.name.toLocaleLowerCase().includes(needle) || variable.description.toLocaleLowerCase().includes(needle))
  }, [query, snapshot])

  const openCreate = () => {
    setFormError(null)
    setEditor({ original: null, name: '', description: '', value: '' })
  }

  const openEdit = (variable: VariableView) => {
    setFormError(null)
    setEditor({ original: variable, name: variable.name, description: variable.description, value: '' })
  }

  const submit = async () => {
    if (editor === null) return
    if (!isVariableName(editor.name)) {
      setFormError(t('form.name.invalid'))
      return
    }
    if (editor.original === null && editor.value.length === 0) {
      setFormError(t('form.value.required'))
      return
    }
    const input: SaveVariableInput = {
      name: editor.name,
      description: editor.description,
      ...(editor.value.length === 0 ? {} : { value: editor.value }),
    }
    if (await props.save(input)) setEditor(null)
  }

  const remove = async (variable: VariableView) => {
    if (!window.confirm(t('delete.confirm', { name: variable.name }))) return
    await props.remove(variable.name)
  }

  if (phase === 'loading') {
    return <section className="dsh-cc-page" aria-label={t('panel.title')}><p className="dsh-cc-state" role="status">{t('state.loading')}</p></section>
  }
  if (phase === 'error') {
    return (
      <section className="dsh-cc-page" aria-label={t('panel.title')}>
        <div className="dsh-cc-error" role="alert"><h2>{t('state.error')}</h2><p>{errorText}</p><button type="button" onClick={props.retry}>{t('action.retry')}</button></div>
      </section>
    )
  }

  return (
    <section className="dsh-cc-page" aria-label={t('panel.title')}>
      <header className="dsh-cc-header">
        <div><h1>{t('panel.title')}</h1><p>{t('panel.subtitle')}</p></div>
        <button type="button" className="dsh-cc-primary" disabled={pending} onClick={openCreate}><span aria-hidden="true">＋</span>{t('action.add')}</button>
      </header>

      <div className="dsh-cc-help"><span className="dsh-cc-code" aria-hidden="true">&lt;/&gt;</span><span>{t('panel.help')}</span></div>

      {errorText !== null && <p className="dsh-cc-notice" role="alert">{errorText}</p>}

      <label className="dsh-cc-search">
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="8.8" cy="8.8" r="5.7" /><path d="m13 13 4 4" /></svg>
        <input value={query} onChange={event => { setQuery(event.target.value) }} placeholder={t('search.placeholder')} aria-label={t('search.placeholder')} />
      </label>

      <div className="dsh-cc-card">
        <div className="dsh-cc-card-head"><strong>{t('table.variables')}</strong><span>{snapshot?.variables.length ?? 0}</span></div>
        {variables.length === 0
          ? <p className="dsh-cc-empty">{t('table.empty')}</p>
          : (
            <div className="dsh-cc-table-wrap">
              <table className="dsh-cc-table">
                <thead><tr><th>{t('table.name')}</th><th>{t('table.description')}</th><th>{t('table.value')}</th><th>{t('table.updated')}</th><th><span className="dsh-cc-sr">Actions</span></th></tr></thead>
                <tbody>{variables.map(variable => (
                  <tr key={variable.name}>
                    <td><code>{variable.name}</code></td>
                    <td>{variable.description || '—'}</td>
                    <td><span className="dsh-cc-secret" aria-label={t('value.configured')}>••••••••••••</span></td>
                    <td><time dateTime={variable.updatedAt}>{relativeTime(variable.updatedAt)}</time></td>
                    <td><div className="dsh-cc-actions">
                      <button type="button" aria-label={`${t('action.edit')} ${variable.name}`} disabled={pending} onClick={() => { openEdit(variable) }}><EditIcon /></button>
                      <button type="button" className="dsh-cc-danger" aria-label={`${t('action.delete')} ${variable.name}`} disabled={pending} onClick={() => { void remove(variable) }}><TrashIcon /></button>
                    </div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
      </div>

      {editor !== null && (
        <div className="dsh-cc-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setEditor(null) }}>
          <form className="dsh-cc-modal" aria-label={editor.original === null ? t('action.add') : t('action.edit')} onSubmit={event => { event.preventDefault(); void submit() }}>
            <div className="dsh-cc-modal-head"><h2>{editor.original === null ? t('action.add') : t('action.edit')}</h2><button type="button" aria-label={t('action.cancel')} onClick={() => { setEditor(null) }}>×</button></div>
            <label><span>{t('form.name')}</span><input autoFocus value={editor.name} disabled={editor.original !== null || pending} placeholder={t('form.name.placeholder')} onChange={event => { setEditor({ ...editor, name: event.target.value.toUpperCase() }) }} /></label>
            <label><span>{t('form.description')}</span><input value={editor.description} disabled={pending} placeholder={t('form.description.placeholder')} onChange={event => { setEditor({ ...editor, description: event.target.value }) }} /></label>
            <label><span>{t('form.value')}</span><input type="password" value={editor.value} disabled={pending} autoComplete="new-password" placeholder={editor.original === null ? t('form.value.create.placeholder') : t('form.value.edit.placeholder')} onChange={event => { setEditor({ ...editor, value: event.target.value }) }} /></label>
            {formError !== null && <p className="dsh-cc-form-error" role="alert">{formError}</p>}
            <div className="dsh-cc-modal-actions"><button type="button" disabled={pending} onClick={() => { setEditor(null) }}>{t('action.cancel')}</button><button type="submit" className="dsh-cc-primary" disabled={pending}>{t('action.save')}</button></div>
          </form>
        </div>
      )}
    </section>
  )
}
