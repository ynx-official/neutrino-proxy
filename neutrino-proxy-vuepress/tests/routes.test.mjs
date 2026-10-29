import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePermalink, buildRewrites, normalizeBase } from '../scripts/routes.mjs'

test('old permalinks resolve to directory indexes with or without the final slash', () => {
  assert.equal(normalizePermalink('/pages/793dcb'), '/pages/793dcb/')
  assert.equal(normalizePermalink('/blog/'), '/blog/')
  assert.deepEqual(buildRewrites([
    { source: 'index.md', route: '/' },
    { source: '01.使用教程/快速上手.md', route: '/pages/793dcb/' },
    { source: '@pages/archivesPage.md', route: '/blog/' },
  ]), {
    '01.使用教程/快速上手.md': 'pages/793dcb/index.md',
    '@pages/archivesPage.md': 'blog/index.md',
  })
})

test('invalid or colliding published routes fail before a build', () => {
  for (const value of ['https://example.com/', '//example.com/', '/../outside/', '/pages/a?x=1', '/pages/a#x', '/pages/%2e%2e/', '/a\\b/']) {
    assert.throws(() => normalizePermalink(value), /Invalid permalink/)
  }
  assert.throws(() => buildRewrites([
    { source: 'a.md', route: '/pages/same' },
    { source: 'b.md', route: '/pages/same/' },
  ]), /Duplicate route/)
})

test('root and repository subpath deployments have unambiguous bases', () => {
  assert.equal(normalizeBase(), '/')
  assert.equal(normalizeBase('/neutrino-proxy'), '/neutrino-proxy/')
  assert.throws(() => normalizeBase('https://example.com/'), /Invalid/)
})
