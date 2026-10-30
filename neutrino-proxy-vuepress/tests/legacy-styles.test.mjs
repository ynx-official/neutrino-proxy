import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createMarkdownRenderer } from 'vitepress'
import { compileTemplate } from 'vue/compiler-sfc'
import config from '../docs/.vitepress/config.mjs'
import { docsRoot, readPages } from '../scripts/content.mjs'

for (const page of readPages().filter(page => /^<style[\s>]/m.test(page.content))) {
  for (const base of ['/', '/neutrino-proxy/']) {
    test(`legacy styles compile outside the development template: ${page.source} (${base})`, async () => {
      const md = await createMarkdownRenderer(docsRoot, config.markdown, base)
      const env = { path: resolve(docsRoot, page.source), relativePath: page.source }
      const html = md.render(readFileSync(env.path, 'utf8'), env)
      const result = compileTemplate({ source: `<div>${html}</div>`, filename: env.path, id: 'legacy-styles', isProd: false })
      assert.deepEqual(result.errors, [])
      const styles = env.sfcBlocks.styles.map(block => block.content).join('\n')
      if (page.data.home) {
        assert.match(styles, /\.become-sponsor/)
        assert.match(styles, /\.friends-item-img/)
        assert.ok(html.includes('redis-front.png'))
      } else {
        assert.match(styles, /\.icons-table/)
      }
    })
  }
}
