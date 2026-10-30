import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import MarkdownIt from 'markdown-it'
import { readPages, siteRoot } from '../scripts/content.mjs'
import { buildNavigation } from '../scripts/navigation.mjs'

const flatten = items => items.flatMap(item => [...(item.link ? [item.link] : []), ...flatten(item.items || [])])

test('source learning has its own entry, complete sidebar and progressive curriculum', () => {
  const pages = readPages()
  const learning = pages.filter(page => page.source.startsWith('07.源码学习/'))
  const lessons = learning.filter(page => page.data.lesson)
  assert.equal(lessons.length, 60)
  assert.equal(new Set(lessons.map(page => page.data.lesson.split('.')[0])).size, 12)
  assert.equal(lessons.filter(page => page.data.track === 'desktop').length, 4)
  const overview = learning.find(page => page.route === '/learn/')
  assert.ok(overview)
  for (const lesson of lessons) {
    assert.ok(overview.content.includes(`](${lesson.route})`), lesson.title)
    assert.ok(['Draft', 'Review', 'Approved'].includes(lesson.data.status), lesson.title)
    for (const heading of ['本篇要解决的问题', '项目源码入口', '正文提纲', '动手实验与验收']) {
      assert.ok(lesson.content.includes(`## ${heading}`), `${lesson.title}: ${heading}`)
    }
    const html = new MarkdownIt().render(lesson.content)
    assert.ok(html.includes('<strong>计划实验</strong>'), `${lesson.title}: experiment label must render as emphasis`)
  }
  const { nav, sidebar } = buildNavigation(pages)
  const entry = nav.find(item => item.text === '源码学习')
  assert.equal(entry?.link, '/learn/')
  assert.match('learn/client-reconnection/index.md', new RegExp(entry.activeMatch))
  assert.doesNotMatch('pages/793dcb/index.md', new RegExp(entry.activeMatch))
  for (const page of learning) {
    assert.deepEqual(flatten(sidebar[page.route]).sort(), learning.map(item => item.route).sort())
  }
  assert.ok(!flatten(sidebar['/pages/793dcb/']).includes('/learn/'))
})

test('planned excerpts refer to existing project symbols without requiring the desktop checkout', () => {
  const lessons = readPages().filter(page => page.data.lesson)
  assert.ok(lessons.length)
  for (const page of lessons) {
    assert.ok(page.data.sourceReferences?.length, page.title)
    for (const reference of page.data.sourceReferences) {
      if (reference.repository === 'desktop') {
        assert.ok(reference.url.startsWith('https://github.com/ynx-official/neutrino-proxy-client-desktop/'))
        continue
      }
      const source = readFileSync(resolve(siteRoot, '..', reference.path), 'utf8')
      assert.ok(source.includes(reference.symbol), `${page.title}: ${reference.path}#${reference.symbol}`)
    }
  }
})

test('the authoring example preserves its verbatim project excerpt', () => {
  const guide = readPages().find(page => page.route === '/learn/authoring/')
  assert.ok(guide)
  const excerpt = guide.content.match(/```java\n([\s\S]*?)\n```/)
  assert.ok(excerpt)
  const source = readFileSync(resolve(siteRoot, '../neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java'), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(source.includes(excerpt[1]), 'Example must remain a verbatim source excerpt')
})
