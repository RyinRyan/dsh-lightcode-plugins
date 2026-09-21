import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
export default defineConfig({
  resolve: { alias: [
    { find: 'lightcode-factory-contracts/types', replacement: resolve('packages/contracts/src/types.ts') },
    { find: 'lightcode-factory-contracts/workflow', replacement: resolve('packages/contracts/src/workflow.ts') },
    { find: 'lightcode-factory-contracts/repository', replacement: resolve('packages/contracts/src/repository.ts') },
    { find: 'lightcode-factory-contracts/schema', replacement: resolve('packages/contracts/src/schema.ts') },
    { find: 'lightcode-factory-contracts/remote', replacement: resolve('packages/contracts/src/remote.ts') },
    { find: /^lightcode-factory-contracts$/, replacement: resolve('packages/contracts/src/index.ts') },
    { find: 'lightcode-factory-runtime/client', replacement: resolve('packages/runtime/src/client/index.ts') },
    { find: /^lightcode-factory-runtime$/, replacement: resolve('packages/runtime/src/index.ts') },
    { find: /^lightcode-factory-storage-sqlite$/, replacement: resolve('packages/storage-sqlite/src/index.ts') },
  ] },
  test: { include: ['packages/*/tests/**/*.spec.{ts,tsx}'], maxWorkers: 2 },
})
