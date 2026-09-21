/** Durable host-side variable store. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type SaveVariableInput, type VariableSnapshot, isVariableName } from '../shared/protocol.js'
import { dshHome } from './profile.js'

interface StoredVariable {
  readonly description: string
  readonly value: string
  readonly updatedAt: string
}

interface VariableDocument {
  readonly version: 1
  readonly revision: number
  readonly variables: Readonly<Record<string, StoredVariable>>
}

export interface VariableStoreOptions {
  readonly dataDir: string
  readonly now?: () => number
}

export class VariableStoreError extends Error {
  constructor(
    readonly code: 'VALIDATION' | 'NOT_FOUND',
    message: string,
  ) {
    super(message)
    this.name = 'VariableStoreError'
  }
}

const DOCUMENT_FILE = 'variables.json'

function emptyDocument(): VariableDocument {
  return { version: 1, revision: 0, variables: {} }
}

function validateDocument(raw: unknown): VariableDocument {
  if (typeof raw !== 'object' || raw === null) throw new Error('document is not an object')
  const document = raw as Record<string, unknown>
  if (document.version !== 1) throw new Error(`unsupported document version ${String(document.version)}`)
  if (!Number.isInteger(document.revision) || (document.revision as number) < 0) {
    throw new Error('revision is invalid')
  }
  if (typeof document.variables !== 'object' || document.variables === null || Array.isArray(document.variables)) {
    throw new Error('variables is not an object')
  }
  const variables: Record<string, StoredVariable> = {}
  for (const [name, unknownEntry] of Object.entries(document.variables as Record<string, unknown>)) {
    if (!isVariableName(name) || typeof unknownEntry !== 'object' || unknownEntry === null) {
      throw new Error(`variable ${name} is invalid`)
    }
    const entry = unknownEntry as Record<string, unknown>
    if (
      typeof entry.description !== 'string'
      || typeof entry.value !== 'string'
      || entry.value.length === 0
      || typeof entry.updatedAt !== 'string'
    ) {
      throw new Error(`variable ${name} fields are invalid`)
    }
    variables[name] = { description: entry.description, value: entry.value, updatedAt: entry.updatedAt }
  }
  return { version: 1, revision: document.revision as number, variables }
}

/**
 * Write via a sibling temp file and rename. Windows can transiently deny the
 * rename while an antivirus scanner holds the target, so retry briefly
 * before giving up; the temp file is then parked as `.orphan` for inspection.
 */
async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temp = join(dirname(path), `.${Math.random().toString(36).slice(2)}-${Date.now()}.tmp`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
  const deadline = Date.now() + 2000
  for (;;) {
    try {
      await rename(temp, path)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if ((code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') && Date.now() < deadline) {
        await new Promise(resolveWait => {
          setTimeout(resolveWait, 50)
        })
        continue
      }
      await rename(temp, `${temp}.orphan`).catch(() => {})
      throw error
    }
  }
}

export class VariableStore {
  private readonly now: () => number
  private document: VariableDocument = emptyDocument()
  private chain: Promise<unknown> = Promise.resolve()
  private loaded = false

  constructor(private readonly options: VariableStoreOptions) {
    this.now = options.now ?? (() => Date.now())
  }

  get documentPath(): string {
    return join(this.options.dataDir, DOCUMENT_FILE)
  }

  async load(): Promise<void> {
    if (this.loaded) return
    try {
      this.document = validateDocument(JSON.parse(await readFile(this.documentPath, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.document = emptyDocument()
    }
    this.loaded = true
  }

  snapshot(): VariableSnapshot {
    const variables = Object.entries(this.document.variables)
      .map(([name, entry]) => ({ name, description: entry.description, configured: true as const, updatedAt: entry.updatedAt }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { revision: this.document.revision, variables }
  }

  get(name: string): string | undefined {
    return this.document.variables[name]?.value
  }

  require(name: string): string {
    const value = this.get(name)
    if (value === undefined) throw new VariableStoreError('NOT_FOUND', `credential variable "${name}" is not configured`)
    return value
  }

  async save(input: SaveVariableInput): Promise<VariableSnapshot> {
    return this.mutate(async () => {
      const current = this.document.variables[input.name]
      if (current === undefined && input.value === undefined) {
        throw new VariableStoreError('VALIDATION', 'a value is required when creating a variable')
      }
      const nextEntry: StoredVariable = {
        description: input.description,
        value: input.value ?? current?.value ?? '',
        updatedAt: new Date(this.now()).toISOString(),
      }
      await this.commit({
        version: 1,
        revision: this.document.revision + 1,
        variables: { ...this.document.variables, [input.name]: nextEntry },
      })
      return this.snapshot()
    })
  }

  async remove(name: string): Promise<VariableSnapshot> {
    return this.mutate(async () => {
      if (this.document.variables[name] === undefined) {
        throw new VariableStoreError('NOT_FOUND', `variable "${name}" does not exist`)
      }
      const variables = { ...this.document.variables }
      delete variables[name]
      await this.commit({ version: 1, revision: this.document.revision + 1, variables })
      return this.snapshot()
    })
  }

  /** Wait for every queued mutation (used on dispose). */
  async dispose(): Promise<void> {
    await this.chain
  }

  /** Serialize mutations through one promise chain, keeping failures isolated. */
  private mutate<T>(step: () => Promise<T>): Promise<T> {
    const next = this.chain.then(step, step)
    this.chain = next.catch(() => {})
    return next
  }

  private async commit(next: VariableDocument): Promise<void> {
    await writeFileAtomic(this.documentPath, `${JSON.stringify(next, null, 2)}\n`)
    this.document = next
  }
}

/** Storage directory; kept at the legacy location so existing variables carry over. */
export function defaultDataDir(): string {
  return join(dshHome(), 'dsh-credential-center')
}
