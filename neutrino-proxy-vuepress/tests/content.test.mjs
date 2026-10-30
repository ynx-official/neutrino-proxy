import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createMarkdownRenderer } from 'vitepress'
import { parseHTML } from 'linkedom'
import config from '../docs/.vitepress/config.mjs'
import { sidebar } from '../docs/.vitepress/navigation.mjs'
import { readPages, docsRoot, siteRoot } from '../scripts/content.mjs'
import { buildRewrites, normalizePermalink } from '../scripts/routes.mjs'

const legacy = JSON.parse(readFileSync(resolve(siteRoot, 'tests/fixtures/legacy-site.json'), 'utf8').replace(/^\uFEFF/, ''))
const compatibility = JSON.parse(readFileSync(resolve(siteRoot, 'tests/fixtures/authoring-compatibility.json'), 'utf8'))
const sha256 = (file, text = false) => createHash('sha256').update(text ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : readFileSync(file)).digest('hex')

test('all 37 original documents retain their rendered content, bookmarks and published addresses', async () => {
  const pages = readPages()
  const rewrites = buildRewrites(pages)
  const md = await createMarkdownRenderer(docsRoot, config.markdown, '/')
  assert.equal(legacy.pages.length, 37)
  assert.equal(compatibility.length, legacy.pages.length)
  for (const original of legacy.pages) {
    const baseline = compatibility.find(page => page.source === original.source)
    assert.equal(baseline.originalTextSha256, original.textSha256, original.source)
    const page = pages.find(page => page.source === original.source)
    assert.equal(page.route, normalizePermalink(original.route))
    assert.equal(rewrites[page.source] || page.source, page.route === '/' ? 'index.md' : `${page.route.slice(1)}index.md`)
    assert.equal(page.title, baseline.title)
    const html = md.render(page.content, { path: resolve(docsRoot, page.source), relativePath: page.source })
    const main = parseHTML(`<main>${html}</main>`).document.querySelector('main')
    for (const id of baseline.ids) assert.ok(main.querySelectorAll('[id]').some(node => node.id === id), `${page.source}: #${id}`)
    // A previously missing article title may now be explicit; existing prose stays identical.
    for (const heading of main.querySelectorAll('h1')) {
      if (!baseline.ids.includes(heading.id) && heading.textContent.replace(/\u200b/g, '').trim() === page.title) heading.remove()
    }
    // Validate newly supplied language labels independently of the unchanged legacy body.
    const codeBlocks = [...main.querySelectorAll('div[class*="language-"]')]
    for (const { index, language } of baseline.addedCodeBlockLanguages || []) {
      const label = codeBlocks[index]?.querySelector('.lang')
      assert.equal(label?.textContent, language, `${page.source}: code block ${index} language`)
      label.remove()
    }
    const text = main.textContent.replace(/\s+/g, ' ').trim()
    assert.equal(createHash('sha256').update(text).digest('hex'), baseline.renderedTextSha256, original.source)
  }
})

test('all 145 original assets are preserved, allowing Git text newline normalization', () => {
  assert.equal(legacy.assets.length, 145)
  for (const asset of legacy.assets) {
    assert.equal(sha256(resolve(docsRoot, 'public', asset.source), Boolean(asset.textSha256)), asset.textSha256 || asset.sha256, asset.source)
  }
})

test('explicit sidebar configuration preserves the published article order', () => {
  const announcements = sidebar['/pages/1ab20b/'].find(group => group.text === '赞赏公示')
  assert.deepEqual(announcements.items.map(item => item.text), ['2024年', '2023年'])
})
