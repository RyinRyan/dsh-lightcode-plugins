const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

const storage = {
  get(key) { try { return localStorage.getItem(key) } catch { return null } },
  set(key, value) { try { localStorage.setItem(key, value) } catch { /* private mode */ } },
}

// Theme
const savedTheme = storage.get('dsh-atlas-theme')
if (savedTheme) document.documentElement.dataset.theme = savedTheme
$('#themeToggle')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  storage.set('dsh-atlas-theme', next)
})

// Mobile navigation
const sidebar = $('#sidebar')
const menuButton = $('#menuButton')
menuButton?.addEventListener('click', () => {
  const open = sidebar?.classList.toggle('is-open') ?? false
  menuButton.setAttribute('aria-expanded', String(open))
})
$$('.toc a').forEach(link => link.addEventListener('click', () => {
  sidebar?.classList.remove('is-open')
  menuButton?.setAttribute('aria-expanded', 'false')
}))

// Reading progress and active chapter
const sections = $$('.section[id]')
const tocLinks = $$('.toc a')
const updateProgress = () => {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight
  const percent = scrollable > 0 ? Math.min(100, Math.max(0, window.scrollY / scrollable * 100)) : 0
  const bar = $('#readingProgress')
  if (bar) bar.style.width = `${percent}%`
}
window.addEventListener('scroll', updateProgress, { passive: true })
updateProgress()

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
    if (!visible) return
    tocLinks.forEach(link => link.classList.toggle('is-active', link.hash === `#${visible.target.id}`))
  }, { rootMargin: '-18% 0px -66%', threshold: [0, .1, .3] })
  sections.forEach(section => observer.observe(section))
}

// Learning route emphasis
const setRoute = route => {
  $$('.route-card').forEach(card => {
    const selected = card.dataset.route === route
    card.classList.toggle('is-selected', selected)
    card.setAttribute('aria-pressed', String(selected))
  })
  $$('.route-detail').forEach(detail => {
    const routes = (detail.dataset.forRoute ?? '').split(' ')
    detail.classList.toggle('is-route-highlight', routes.includes(route))
  })
  storage.set('dsh-atlas-route', route)
}
$$('.route-card').forEach(card => card.addEventListener('click', () => setRoute(card.dataset.route)))
setRoute(storage.get('dsh-atlas-route') ?? 'beginner')

// Cordis concept accordion
$$('.concept-card').forEach(card => card.addEventListener('click', () => {
  const willOpen = !card.classList.contains('is-open')
  $$('.concept-card').forEach(item => {
    item.classList.remove('is-open')
    item.setAttribute('aria-expanded', 'false')
  })
  if (willOpen) {
    card.classList.add('is-open')
    card.setAttribute('aria-expanded', 'true')
  }
}))

// Lifecycle explorer
const lifeContent = {
  discover: ['发现配置', 'Profile 与 Bundle patch 组合出 Loader 行；先确认 id、name 与 config 是否进入最终树。', '常见错：还没 dump-config 就直接排查业务代码。'],
  inject: ['等待依赖', 'Cordis 根据 service key 等待能力就绪，不按文件顺序赌启动时机。', '常见错：把 npm import、dsh.client.inject 与 Cordis inject 混成一件事。'],
  apply: ['Apply / Init', '配置通过 schema 校验后，插件注册 Service、事件、Remote 或业务贡献。', '常见错：在模块顶层产生副作用，绕开 fiber 生命周期。'],
  work: ['运行', '插件处理调用、写入状态、上报事件；所有在途工作都要能定位、取消和观测。', '常见错：启动 detached Promise，dispose 无法等待它。'],
  dispose: ['Dispose', '先停止接收新工作，再取消并等待任务，最后 flush 存储和关闭连接。', '常见错：只发 abort 就返回，导致晚到写入与数据丢失。'],
}
$$('.life-step').forEach(step => step.addEventListener('click', () => {
  $$('.life-step').forEach(item => {
    item.classList.remove('is-active')
    item.setAttribute('aria-selected', 'false')
  })
  step.classList.add('is-active')
  step.setAttribute('aria-selected', 'true')
  const [title, description, warning] = lifeContent[step.dataset.life]
  const detail = $('#lifeDetail')
  if (detail) detail.innerHTML = `<strong>${title}</strong><p>${description}</p><span>${warning}</span>`
}))

// Plugin type filter
$$('.filter-chip').forEach(button => button.addEventListener('click', () => {
  const filter = button.dataset.filter
  $$('.filter-chip').forEach(item => {
    const selected = item === button
    item.classList.toggle('is-active', selected)
    item.setAttribute('aria-pressed', String(selected))
  })
  $$('.type-card').forEach(card => {
    const categories = (card.dataset.category ?? '').split(' ')
    card.classList.toggle('is-hidden', filter !== 'all' && !categories.includes(filter))
  })
}))

// Dependency lab
const dependencyData = {
  runtime: {
    label: 'dependencies', example: 'zod · 业务运行库',
    description: '安装后的 Node 入口真实 import，由包管理器提供。',
    rule: '规则：运行时缺少它，Host 会直接加载失败。',
  },
  identity: {
    label: 'peerDependencies', example: '@deepseek-ai/cordis',
    description: 'Cordis、React 等必须与宿主共享唯一运行时身份，插件不能私带第二份。',
    rule: '规则：peer 表达兼容范围；构建时仍需 devDependency 提供类型。',
  },
  build: {
    label: 'devDependencies', example: 'typescript · esbuild · vitest',
    description: '只参与开发、类型检查、构建和测试，不是 Host 安装后的业务能力。',
    rule: '规则：发布物需要的产物必须在 pack 前已经生成。',
  },
  browser: {
    label: 'dsh.client.external', example: '精确的浏览器模块请求',
    description: '决定 client.js 私有打包什么、从 DSH 模块表共享什么；与 npm section 是独立判断。',
    rule: '规则：基座 external 不重复声明；业务插件不能借 external 互相 import 组件。',
  },
}
$$('.dep-tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.dep-tab').forEach(item => {
    const selected = item === tab
    item.classList.toggle('is-active', selected)
    item.setAttribute('aria-selected', String(selected))
  })
  const data = dependencyData[tab.dataset.dep]
  $('#depLabel').textContent = data.label
  $('#depExample').textContent = data.example
  $('#depDescription').textContent = data.description
  $('#depRule').textContent = data.rule
}))

$$('.filter-chip').forEach(item => item.setAttribute('aria-pressed', String(item.classList.contains('is-active'))))
$$('.dep-tab').forEach(item => item.setAttribute('aria-selected', String(item.classList.contains('is-active'))))

// Copy helpers
const copyText = async text => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    return copied
  }
}
$$('.copy-button').forEach(button => button.addEventListener('click', async () => {
  const target = document.getElementById(button.dataset.copy)
  if (!target) return
  const original = button.textContent
  button.textContent = await copyText(target.textContent) ? '已复制' : '复制失败'
  setTimeout(() => { button.textContent = original }, 1500)
}))

// Requirement → bundle blueprint
const form = $('#blueprintForm')
const blueprintState = () => {
  const values = new FormData(form)
  return {
    trigger: values.get('trigger'),
    delivery: values.get('delivery'),
    capabilities: values.getAll('capability'),
  }
}

const renderBlueprint = () => {
  const { trigger, delivery, capabilities } = blueprintState()
  const has = capability => capabilities.includes(capability)
  const packages = []
  const contracts = []
  const checks = []

  if (trigger === 'model' && !has('state') && !has('workflow')) {
    packages.push('my-tool')
    contracts.push('Tool 参数与 output schema', '工具权限、超时与错误语义')
    checks.push('确定性 execute 单测', '真实 Agent 能发现并调用工具')
  } else {
    packages.push(trigger === 'external' ? 'my-gateway' : 'my-backend')
    contracts.push('Service key 与 Config schema', '状态机、取消与重启行为')
    checks.push('Service 生命周期与竞态单测', 'Host 组合测试')
  }

  if (has('workflow')) {
    packages.push('my-workflow')
    contracts.push('工作流/节点版本与输入输出', '评审、幂等和终态规则')
    checks.push('节点失败与晚到结果测试')
  }
  if (trigger === 'user' || has('ui')) {
    if (!packages.includes('my-backend')) packages.push('my-backend')
    packages.push('my-web')
    contracts.push('Remote wire schema', 'Client slot、store 与 locale')
    checks.push('client.js 发布视图', 'UI 组件与 Remote 错误态')
  }
  if (trigger === 'external') {
    contracts.push('外部协议版本、认证与错误映射')
    checks.push('断线、取消与协议兼容测试')
  }
  if (delivery === 'bundle') {
    packages.push('my-product-bundle')
    contracts.push('bundle patch 与 peer 兼容范围')
    checks.push('隔离 profile add / run / restart / remove')
  } else {
    checks.push('--patch overlay + dump-config')
  }

  const unique = list => [...new Set(list)]
  const title = has('workflow') ? '工作流产品 Bundle' : has('ui') || trigger === 'user' ? '双端业务 Bundle' : trigger === 'external' ? '协议网关 Bundle' : '轻量 Tool Bundle'
  $('#blueprintTitle').textContent = title
  $('#blueprintPackages').innerHTML = unique(packages).map(name => `<span>${name}</span>`).join('')
  $('#blueprintContracts').innerHTML = unique(contracts).map(item => `<li>${item}</li>`).join('')
  $('#blueprintChecks').innerHTML = unique(checks).map(item => `<li>${item}</li>`).join('')

  const warnings = []
  if (has('untrusted')) warnings.push('不可信代码不得进程内加载：增加独立 worker/container，并用版本化窄 RPC。')
  if (has('state')) warnings.push('先决定 checkpoint 能力；未实现恢复时，重启必须明确标记失败。')
  if (!warnings.length) warnings.push('发布前仍需核对目标 DSH/Cordis 的精确版本与接口。')
  $('#blueprintWarning').textContent = warnings.join(' ')
}
form?.addEventListener('change', renderBlueprint)
renderBlueprint()

$('#copyBlueprint')?.addEventListener('click', async event => {
  const { trigger, delivery, capabilities } = blueprintState()
  const packages = $$('#blueprintPackages span').map(item => item.textContent).join(', ')
  const contracts = $$('#blueprintContracts li').map(item => `- ${item.textContent}`).join('\n')
  const checks = $$('#blueprintChecks li').map(item => `- ${item.textContent}`).join('\n')
  const text = `# ${$('#blueprintTitle').textContent}\n\n触发：${trigger}\n能力：${capabilities.join(', ') || '轻量动作'}\n交付：${delivery}\n包：${packages}\n\n## 契约\n${contracts}\n\n## 验收\n${checks}\n\n注意：${$('#blueprintWarning').textContent}`
  const button = event.currentTarget
  const original = button.textContent
  button.textContent = await copyText(text) ? '已复制' : '复制失败'
  setTimeout(() => { button.textContent = original }, 1500)
})
