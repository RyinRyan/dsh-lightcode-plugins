import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConfigurationCenter } from '../src/client/ConfigurationCenter.js'

test('renders one configuration-center shell with credential and plugin tabs', () => {
  const html = renderToStaticMarkup(<ConfigurationCenter
    t={key => ({ 'panel.title': '配置中心', 'panel.subtitle': '集中管理凭据与 DSH 插件', 'tabs.credentials': '凭据管理', 'tabs.plugins': '插件管理' }[key] ?? key)}
    credentialsApi={{ list: async () => ({ revision: 0, variables: [] }), save: async () => ({ revision: 0, variables: [] }), remove: async () => ({ revision: 0, variables: [] }) }}
    installerApi={{ status: async () => ({ profile: 'web', maxUploadBytes: 1024, allowInstallScripts: false, staged: null, packages: [], operation: null }), inspect: async () => { throw new Error('not used during render') }, install: async () => {}, remove: async () => {}, restart: async () => {} }}
    installerT={key => key}
  />)
  assert.match(html, /配置中心/)
  assert.match(html, /凭据管理/)
  assert.match(html, /插件管理/)
  assert.doesNotMatch(html, /Tar 包安装/)
})
