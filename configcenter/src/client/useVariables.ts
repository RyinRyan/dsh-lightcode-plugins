/** Client state machine for loading and mutating variable rows. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SaveVariableInput, VariableSnapshot } from '../shared/protocol.js'
import type { CredentialCenterApi } from './api.js'

export type PanelPhase = 'loading' | 'ready' | 'error'

export interface VariablePanelState {
  readonly phase: PanelPhase
  readonly snapshot: VariableSnapshot | null
  readonly pending: boolean
  readonly errorText: string | null
}

export interface VariablePanelCommands {
  save(input: SaveVariableInput): Promise<boolean>
  remove(name: string): Promise<boolean>
  retry(): void
}

const INITIAL: VariablePanelState = { phase: 'loading', snapshot: null, pending: false, errorText: null }

export function useVariables(api: CredentialCenterApi): VariablePanelState & VariablePanelCommands {
  const [state, setState] = useState(INITIAL)
  const alive = useRef(true)
  const busy = useRef(false)

  useEffect(() => () => { alive.current = false }, [])

  const patch = useCallback((next: Partial<VariablePanelState>) => {
    if (alive.current) setState(previous => ({ ...previous, ...next }))
  }, [])

  const load = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    patch({ pending: true })
    try {
      patch({ phase: 'ready', snapshot: await api.list(), pending: false, errorText: null })
    } catch (error) {
      patch({ phase: 'error', snapshot: null, pending: false, errorText: error instanceof Error ? error.message : String(error) })
    } finally {
      busy.current = false
    }
  }, [api, patch])

  useEffect(() => { void load() }, [load])

  const run = useCallback(async (command: () => Promise<VariableSnapshot>): Promise<boolean> => {
    if (busy.current) return false
    busy.current = true
    patch({ pending: true, errorText: null })
    try {
      patch({ phase: 'ready', snapshot: await command(), pending: false })
      return true
    } catch (error) {
      patch({ pending: false, errorText: error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      busy.current = false
    }
  }, [patch])

  return {
    ...state,
    save: input => run(() => api.save(input)),
    remove: name => run(() => api.remove(name)),
    retry: () => { void load() },
  }
}
