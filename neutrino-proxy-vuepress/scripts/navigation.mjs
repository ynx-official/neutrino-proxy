import { buildSidebar } from './content.mjs'

export function buildNavigation(pages) {
  const roots = {
    docs: ['01.使用教程/'],
    history: ['02.常见问题/'],
    support: ['03.支持我们/', '06.关于我们/'],
    examples: ['04.案例/'],
    releases: ['05.更新记录/'],
  }
  const sections = Object.fromEntries(Object.entries(roots).map(([name, prefixes]) => [
    name, pages.filter(page => prefixes.some(prefix => page.source.startsWith(prefix))),
  ]))
  const sidebar = {}
  for (const [name, documents] of Object.entries(sections)) {
    const items = name === 'history'
      ? [{ text: '历史站点资料', collapsed: false, items: documents.map(page => ({ text: page.title, link: page.route })) }]
      : buildSidebar(documents, { stripRoot: true })
    // Public URLs are opaque legacy permalinks; their source directories determine the section.
    for (const page of documents) sidebar[page.route] = items
  }
  for (const page of pages) {
    if (page.route !== '/' && !page.data.archivesPage && !sidebar[page.route]) {
      throw new Error(`Missing navigation section: ${page.source}`)
    }
  }
  const entry = (route, text) => {
    const page = pages.find(page => page.route === route)
    if (!page) throw new Error(`Missing navigation destination: ${route}`)
    return { text: text || page.title, link: route }
  }
  // Include every article, even those absent from the shortcut dropdown, in the active state.
  const activeMatch = (...names) => `^/?(?:${names.flatMap(name => sections[name]).map(page =>
    page.route.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`
  const nav = [
    { text: '首页', link: '/' },
    {
      text: '文档', activeMatch: activeMatch('docs', 'history'), items: [
        entry('/pages/793dcb/', '安装部署'),
        entry('/pages/793dcc/', '使用须知'),
        entry('/pages/31d253/', '常见问题'),
      ],
    },
    { ...entry('/pages/5d571c/', '案例'), activeMatch: activeMatch('examples') },
    {
      text: '支持', activeMatch: activeMatch('support'), items: [
        entry('/pages/a3f096/', '贡献指南'), entry('/pages/1ab20b/'), entry('/pages/acdf0a/', '赞赏公示'),
      ],
    },
    {
      text: '更新记录', activeMatch: activeMatch('releases'), items: [
        entry('/pages/ff3519/', '2.x 版本'), entry('/pages/dda8e5/', '1.x 版本'), entry('/pages/e406dd/'),
      ],
    },
  ]
  return { nav, sidebar }
}
