import test from 'node:test'
import assert from 'node:assert/strict'
import { readPages } from '../scripts/content.mjs'
import { nav, sidebar } from '../docs/.vitepress/navigation.mjs'

const pages = readPages()
const links = items => items.flatMap(item => [
  ...(item.link ? [item.link] : []),
  ...links(item.items || []),
])

test('each document sidebar contains only its section and preserves every article', () => {
  const sections = [
    ['01.使用教程/'], ['02.常见问题/'], ['03.支持我们/', '06.关于我们/'],
    ['04.案例/'], ['05.更新记录/'], ['07.源码学习/'],
  ]
  for (const roots of sections) {
    const documents = pages.filter(page => roots.some(root => page.source.startsWith(root)))
    for (const page of documents) {
      assert.deepEqual(links((sidebar[page.route] || (page.route.startsWith('/learn/') ? sidebar['/learn/'] : undefined))).sort(), documents.map(page => page.route).sort(), page.route)
    }
  }
  assert.equal(sidebar['/'], undefined)
  assert.equal(sidebar['/blog/'], undefined)
  assert.deepEqual(sidebar['/pages/793dcb/'].map(item => item.text), ['安装部署', '使用须知', '常见问题'])
  assert.ok(sidebar['/pages/793dcb/'].every(item => item.collapsed === false))
  assert.equal(sidebar['/pages/a20ce8/'][0].text, '历史站点资料')
})

test('top navigation provides section dropdowns with valid legacy destinations', () => {
  for (const name of ['文档', '支持', '更新记录']) {
    assert.ok(nav.find(item => item.text === name)?.items.length, name)
  }
  const destinations = links(nav)
  for (const route of destinations) assert.ok(pages.some(page => page.route === route), route)
  assert.deepEqual(nav.find(item => item.text === '文档').items, [
    { text: '安装部署', link: '/pages/793dcb/' },
    { text: '使用须知', link: '/pages/793dcc/' },
    { text: '常见问题', link: '/pages/31d253/' },
  ])
  // A page not listed in a dropdown must still highlight its owning section.
  assert.match('pages/68badb/index.md', new RegExp(nav.find(item => item.text === '文档').activeMatch))
  assert.doesNotMatch('pages/acdf0a/index.md', new RegExp(nav.find(item => item.text === '文档').activeMatch))
})

test('support sidebar keeps the original numeric ordering across section grouping', () => {
  const announcements = sidebar['/pages/1ab20b/'].find(item => item.text === '赞赏公示')
  assert.deepEqual(announcements.items.map(item => item.text), ['2024年', '2023年'])
})
