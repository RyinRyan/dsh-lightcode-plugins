/** Browser API client for the credential routes. */
import { ROUTE_PREFIX, type SaveVariableInput, type VariableSnapshot } from '../shared/protocol.js'
import { type FetchLike, fetchJson, jsonInit, unwrapJson } from './http.js'

export interface CredentialCenterApi {
  list(): Promise<VariableSnapshot>
  save(input: SaveVariableInput): Promise<VariableSnapshot>
  remove(name: string): Promise<VariableSnapshot>
}

/** Create the same-origin browser API. */
export function createCredentialCenterApi(
  doFetch: FetchLike = (input, init) => globalThis.fetch(input, init),
): CredentialCenterApi {
  const call = async (path: string, init?: Parameters<FetchLike>[1]): Promise<VariableSnapshot> =>
    unwrapJson<VariableSnapshot>(await fetchJson(doFetch, `${ROUTE_PREFIX}${path}`, init))
  return {
    list: () => call('/variables'),
    save: input => call('/variables', jsonInit(input)),
    remove: name => call('/delete', jsonInit({ name })),
  }
}
