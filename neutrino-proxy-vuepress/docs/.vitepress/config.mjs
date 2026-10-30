import { defineConfig } from 'vitepress'
import { readPages } from '../../scripts/content.mjs'
import { nav, sidebar } from './navigation.mjs'
import { buildRewrites, normalizeBase } from '../../scripts/routes.mjs'
import { legacySlugify } from '../../scripts/legacy-markdown.mjs'
import { validateDomain, writeDeploymentFiles } from '../../scripts/deployment.mjs'

const pages = readPages()
const base = normalizeBase(process.env.DOCS_BASE || '/')
const domain = validateDomain(process.env.DOCS_DOMAIN || '', base)

export default defineConfig({
  lang: 'zh-CN',
  title: '中微子代理',
  description: '一个基于 Netty 的开源内网穿透项目',
  base,
  rewrites: buildRewrites(pages),
  lastUpdated: true,
  buildEnd: site => writeDeploymentFiles(site.outDir, pages, base, domain),
  head: [
    ['link', { rel: 'icon', href: `${base}img/favicon.ico` }],
    ['meta', { name: 'theme-color', content: '#00b48a' }],
  ],
  themeConfig: {
    logo: '/img/logo.png',
    nav,
    sidebar,
    outline: { label: '本页目录', level: [2, 3] },
    socialLinks: [{ icon: 'github', link: 'https://github.com/ynx-official/neutrino-proxy' }],
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: { text: '最后更新', formatOptions: { dateStyle: 'medium' } },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '文档目录',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换为浅色',
    darkModeSwitchTitle: '切换为深色',
    skipToContentLabel: '跳到正文',
    notFound: { code: '404', title: '页面不存在', quote: '可以返回首页，或使用搜索查找文档。', linkLabel: '返回首页', linkText: '返回首页' },
    footer: { message: `基于 MIT 许可证发布 · <a href="${base}pages/a20ce8/">历史站点资料</a>`, copyright: '中微子代理 · Neutrino Proxy' },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: { displayDetails: '显示详情', resetButtonTitle: '清除搜索', backButtonTitle: '关闭搜索', noResultsText: '没有找到相关文档', footer: { selectText: '选择', selectKeyAriaLabel: '回车', navigateText: '切换', navigateUpKeyAriaLabel: '上', navigateDownKeyAriaLabel: '下', closeText: '关闭', closeKeyAriaLabel: 'Esc' } },
        },
        miniSearch: {
          // Segment Chinese prose as words; the default whitespace tokenizer misses it.
          options: { tokenize: text => Array.from(new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text), part => part.isWordLike ? part.segment.toLowerCase() : '').filter(Boolean) },
          searchOptions: { prefix: true, fuzzy: 0.2 },
        },
      },
    },
  },
  // Keep existing VuePress heading bookmarks; new content uses native Markdown.
  markdown: { anchor: { slugify: legacySlugify } },
})
