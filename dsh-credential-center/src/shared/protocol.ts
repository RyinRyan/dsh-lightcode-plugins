/** Shared wire types and validation for dsh-credential-center. */

export const ROUTE_PREFIX = '/dsh-credential-center'
export const MAX_BODY_BYTES = 70 * 1024
export const MAX_VALUE_LENGTH = 64 * 1024
export const MAX_DESCRIPTION_LENGTH = 240

const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** One browser-safe row. Secret values never cross the read API. */
export interface VariableView {
  readonly name: string
  readonly description: string
  readonly configured: true
  readonly updatedAt: string
}

export interface VariableSnapshot {
  readonly revision: number
  readonly variables: readonly VariableView[]
}

export interface SaveVariableInput {
  readonly name: string
  readonly description: string
  /** Omit while editing to keep the stored value unchanged. */
  readonly value?: string
}

export type WireErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL'

export interface ApiOk<T> {
  readonly ok: true
  readonly value: T
}

export interface ApiFail {
  readonly ok: false
  readonly error: { readonly code: WireErrorCode; readonly message: string }
}

export type ApiResult<T> = ApiOk<T> | ApiFail

export function apiOk<T>(value: T): ApiOk<T> {
  return { ok: true, value }
}

export function apiFail(code: WireErrorCode, message: string): ApiFail {
  return { ok: false, error: { code, message } }
}

export function isVariableName(value: unknown): value is string {
  return typeof value === 'string' && VARIABLE_NAME_PATTERN.test(value)
}

export function validateSaveInput(value: unknown): SaveVariableInput {
  if (typeof value !== 'object' || value === null) throw new TypeError('request body must be an object')
  const input = value as Record<string, unknown>
  if (!isVariableName(input.name)) {
    throw new TypeError('variable name must match [A-Za-z_][A-Za-z0-9_]*')
  }
  if (typeof input.description !== 'string' || input.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new TypeError(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters`)
  }
  if (input.value !== undefined && (typeof input.value !== 'string' || input.value.length === 0 || input.value.length > MAX_VALUE_LENGTH)) {
    throw new TypeError(`value must be non-empty and at most ${MAX_VALUE_LENGTH} characters`)
  }
  return {
    name: input.name,
    description: input.description.trim(),
    ...(input.value === undefined ? {} : { value: input.value }),
  }
}
