import { expect, it, vi } from 'vitest'
import type { ILightcodeFactoryClient } from 'lightcode-factory-runtime/client'
import { createFactoryWebInjected } from '../src/client/index.ts'

it('forwards a scheduled time through the Web slot adapter', async () => {
  const start = vi.fn().mockResolvedValue({})
  const client = {
    state: { getSnapshot: () => ({}), subscribe: () => () => {} },
    refresh: vi.fn(), loadMore: vi.fn(), getRun: vi.fn(), start, cancel: vi.fn(), review: vi.fn(),
  } as unknown as ILightcodeFactoryClient

  await createFactoryWebInjected(client).start('report', { subject: 'scheduled' }, '2099-01-02T03:04:00.000Z')

  expect(start).toHaveBeenCalledWith('report', { subject: 'scheduled' }, '2099-01-02T03:04:00.000Z')
})
