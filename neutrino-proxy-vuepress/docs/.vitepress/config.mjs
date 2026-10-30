import { defineConfig } from 'vitepress'
import container from 'markdown-it-container'
import { readPages } from '../../scripts/content.mjs'
import { buildNavigation } from '../../scripts/navigation.mjs'
import { buildRewrites, normalizeBase } from '../../scripts/routes.mjs'
import { legacySlugify } from '../../scripts/legacy-markdown.mjs'
import { validateDomain, writeDeploymentFiles } from '../../scripts/deployment.mjs'

const pages = readPages()
const navigation = buildNavigation(pages)
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
    nav: navigation.nav,
    sidebar: navigation.sidebar,
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
  transformPageData(page) {
    const fm = page.frontmatter
    if (fm.home) {
      page.title = fm.heroText
      fm.layout = 'home'
      fm.hero = {
        name: fm.heroText,
        text: '中微子代理文档',
        tagline: fm.tagline,
        image: { src: fm.heroImage, alt: 'Neutrino Proxy' },
        actions: [{ theme: 'brand', text: '开始使用', link: fm.actionLink }, { theme: 'alt', text: '后台操作指南', link: '/pages/793dcc/' }],
      }
    }
  },
  markdown: {
    anchor: { slugify: legacySlugify },
    config(md) {
      md.use(container, 'center', { render: (tokens, index) => tokens[index].nesting === 1 ? '<div class="legacy-center">\n' : '</div>\n' })
      // Keep original Markdown untouched. Supply title/archive content formerly rendered by Vdoing.
      md.core.ruler.before('normalize', 'legacy-page-content', state => {
        const page = pages.find(page =>
          state.env.relativePath?.replaceAll('\\', '/') === page.source ||
          (state.env.realPath || state.env.path)?.replaceAll('\\', '/').endsWith(`/${page.source}`))
        if (!page) return
        // A style immediately after legacy HTML shares its block. Separate it so
        // VitePress extracts an SFC style instead of leaving it in the template.
        state.src = state.src.replace(/(<\/(?:div|table)>[ \t]*\r?\n)(?=<style(?:\s|>))/g, '$1\n')
        if (page.data.home) return
        let prefix = /^# /m.test(page.content) ? '' : `# ${page.title}\n\n`
        if (page.source.startsWith('02.常见问题/')) {
          prefix += '::: info 历史主题文档\n以下为原 VuePress / Vdoing 配置说明，内容与旧链接保留供查阅；当前站点已迁移至 VitePress。\n:::\n\n'
        }
        if (page.data.archivesPage) {
          prefix += pages.filter(item => item.route !== '/' && !item.data.archivesPage).map(item => `- [${item.title}](${item.route})`).join('\n') + '\n'
        }
        state.src = prefix + state.src.replace(/\]\(\/pages\/(088c16|33d574)\//g, '](https://doc.xugaoyi.com/pages/$1/')
      })
      // VitePress handles Markdown URLs itself; raw HTML needs the same base prefix.
      for (const rule of ['html_block', 'html_inline']) {
        const original = md.renderer.rules[rule]
        md.renderer.rules[rule] = (tokens, index, options, env, self) => {
          const html = original ? original(tokens, index, options, env, self) : tokens[index].content
          return html
            .replace(/\bsrc=(['"])(?:\.\/)?img\//g, (_, quote) => `src=${quote}/img/`)
            // Bind public images at runtime so Vue does not import /<base>/img as a module.
            .replace(/(?<![:\w])src=(['"])\/(?!\/)([^'"]*)\1/g, (_, quote, path) => `:src="$withBase('/${path}')"`)
            .replace(/(?<![:\w])href=(['"])\/(?!\/)([^'"]*)\1/g, (_, quote, path) => `href=${quote}${base}${path}${quote}`)
        }
      }
    },
  },
})
