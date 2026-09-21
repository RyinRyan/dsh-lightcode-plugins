import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CredentialPanel } from '../src/client/CredentialPanel.js'
import { zh } from '../src/client/locales.js'

const t = (key: keyof typeof zh, params?: Record<string, string | number>): string => {
  let value: string = zh[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{${name}}`, String(replacement))
  return value
}

test('renders the approved variable-list information hierarchy', () => {
  const html = renderToStaticMarkup(<CredentialPanel
    t={t}
    phase="ready"
    pending={false}
    errorText={null}
    snapshot={{ revision: 1, variables: [{ name: 'DEEPSEEK_API_KEY', description: 'DeepSeek 模型服务', configured: true, updatedAt: new Date().toISOString() }] }}
    save={async () => true}
    remove={async () => true}
    retry={() => {}}
  />)
  assert.match(html, /配置中心/)
  assert.match(html, /新增变量/)
  assert.match(html, /DEEPSEEK_API_KEY/)
  assert.match(html, /DeepSeek 模型服务/)
  assert.doesNotMatch(html, /安全状态|即将过期|授权插件/)
})
