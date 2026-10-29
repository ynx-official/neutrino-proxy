import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { readPages, buildSidebar, docsRoot, siteRoot } from '../scripts/content.mjs'
import { buildRewrites, normalizePermalink } from '../scripts/routes.mjs'

const legacy = JSON.parse(readFileSync(resolve(siteRoot, 'tests/fixtures/legacy-site.json'), 'utf8').replace(/^\uFEFF/, ''))
const sha256 = (file, text = false) => createHash('sha256').update(text ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : readFileSync(file)).digest('hex')

test('all 37 original documents retain their content and published addresses', () => {
  const pages = readPages()
  assert.equal(legacy.pages.length, 37)
  for (const original of legacy.pages) {
    assert.equal(sha256(resolve(docsRoot, original.source), true), original.textSha256, original.source)
    assert.equal(pages.find(page => page.source === original.source)?.route, normalizePermalink(original.route))
  }
  assert.equal(Object.keys(buildRewrites(pages)).length, pages.length - 1)
})

test('all 145 original assets are preserved, allowing Git text newline normalization', () => {
  assert.equal(legacy.assets.length, 145)
  for (const asset of legacy.assets) {
    assert.equal(sha256(resolve(docsRoot, 'public', asset.source), Boolean(asset.textSha256)), asset.textSha256 || asset.sha256, asset.source)
  }
})

test('numeric folder/file ordering preserves the Vdoing sidebar order', () => {
  const support = buildSidebar(readPages()).find(group => group.text === '支持我们')
  assert.deepEqual(support.items.find(group => group.text === '赞赏公示').items.map(item => item.text), ['2024年', '2023年'])
})
