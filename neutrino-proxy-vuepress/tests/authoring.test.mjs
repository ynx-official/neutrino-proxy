import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { readPages } from '../scripts/content.mjs'
import { buildRewrites } from '../scripts/routes.mjs'

test('ordinary Markdown uses native file routes without custom frontmatter', t => {
  const prefix = resolve(tmpdir(), 'vitepress-authoring-')
  const root = mkdtempSync(prefix)
  t.after(() => {
    assert.ok(root.startsWith(prefix))
    rmSync(root, { recursive: true, force: true })
  })
  mkdirSync(resolve(root, 'guide'))
  writeFileSync(resolve(root, 'index.md'), '# 文档首页\n')
  writeFileSync(resolve(root, 'guide/index.md'), '# 使用指南\n')
  writeFileSync(resolve(root, 'guide/first-step.md'), '# 第一步\n\n直接编辑正文。\n')
  const pages = readPages(root)
  assert.equal(pages.find(page => page.source === 'guide/index.md').route, '/guide/')
  assert.equal(pages.find(page => page.source === 'guide/first-step.md').route, '/guide/first-step.html')
  assert.equal(pages.find(page => page.source === 'guide/first-step.md').title, '第一步')
  assert.deepEqual(buildRewrites(pages), {})
})

test('existing pages declare their own titles and the homepage uses native frontmatter', () => {
  const pages = readPages()
  const home = pages.find(page => page.route === '/')
  assert.equal(home.data.layout, 'home')
  assert.equal(home.data.hero.name, 'Neutrino-Proxy')
  assert.equal(home.data.hero.actions[0].link, '/pages/793dcb/')
  for (const page of pages.filter(page => page.data.layout !== 'home')) {
    assert.match(page.content, /^# .+/m, page.source)
  }
})
