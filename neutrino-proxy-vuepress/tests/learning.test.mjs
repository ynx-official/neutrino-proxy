import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import MarkdownIt from 'markdown-it'
import { readPages, siteRoot } from '../scripts/content.mjs'
import { nav, sidebar } from '../docs/.vitepress/navigation.mjs'

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
    assert.ok(['Review', 'Approved'].includes(lesson.data.status), `${lesson.title}: the 60-lesson curriculum must contain completed text`)
    for (const heading of ['本篇要解决的问题', '项目源码入口', '正文提纲', '动手实验与验收']) {
      assert.ok(lesson.content.includes(`## ${heading}`) || lesson.content.includes(`id="${heading}"`), `${lesson.title}: preserve bookmark ${heading}`)
    }
    const html = new MarkdownIt().render(lesson.content)
    assert.ok(html.includes('<strong>计划实验</strong>') || html.includes('<strong>动手试试</strong>'), `${lesson.title}: exercise label must render as emphasis`)
  }
  const entry = nav.find(item => item.text === '源码学习')
  assert.equal(entry?.link, '/learn/')
  assert.match('learn/client-reconnection/index.md', new RegExp(entry.activeMatch))
  assert.doesNotMatch('pages/793dcb/index.md', new RegExp(entry.activeMatch))
  for (const page of learning) {
    assert.deepEqual(flatten((sidebar[page.route] || (page.route.startsWith('/learn/') ? sidebar['/learn/'] : undefined))).sort(), learning.map(item => item.route).sort())
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
  const excerpt = guide.content.replace(/\r\n/g, '\n').match(/```java\n([\s\S]*?)\n```/)
  assert.ok(excerpt)
  const source = readFileSync(resolve(siteRoot, '../neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java'), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(source.includes(excerpt[1]), 'Example must remain a verbatim source excerpt')
})

test('the completed overview has traceable verbatim excerpts and a reproducible lab', () => {
  const overview = readPages().find(page => page.route === '/learn/project-overview/')
  assert.ok(['Review', 'Approved'].includes(overview.data.status))
  assert.ok(!overview.content.includes('章节已规划，正文待完善'))
  const excerpts = [...overview.content.replace(/\r\n/g, '\n').matchAll(/```(java|xml)\n([\s\S]*?)\n```/g)]
  assert.ok(excerpts.length >= 6)
  assert.equal(excerpts.length, overview.data.sourceExcerpts.length)
  for (const [index, reference] of overview.data.sourceExcerpts.entries()) {
    const source = readFileSync(resolve(siteRoot, '..', reference.path), 'utf8').replace(/\r\n/g, '\n')
    const actual = source.split('\n').slice(reference.startLine - 1, reference.endLine).join('\n')
    assert.equal(excerpts[index][2], actual, reference.path)
    assert.ok(overview.content.includes(`${reference.path}#L${reference.startLine}-L${reference.endLine}`))
  }
  assert.ok(overview.content.includes('python scripts/learning/project_overview.py'))
  assert.ok(overview.content.includes('localhost'))
  assert.ok(overview.content.includes('NAT'))
  assert.ok(overview.content.includes('id="完善清单"'), 'Keep the original chapter bookmark after replacing the draft checklist')
})

test('every completed Java lesson keeps literal excerpts aligned with real project lines', () => {
  for (const page of readPages().filter(page => page.data.lesson && page.data.track === 'java' && page.data.status !== 'Draft')) {
    const excerpts = [...page.content.replace(/\r\n/g, '\n').matchAll(/```(java|xml|sql|python|yaml)\n([\s\S]*?)\n```/g)]
    assert.ok(page.data.sourceExcerpts?.length, page.title)
    assert.equal(excerpts.length, page.data.sourceExcerpts.length, page.title)
    for (const [index, reference] of page.data.sourceExcerpts.entries()) {
      const source = readFileSync(resolve(siteRoot, '..', reference.path), 'utf8').replace(/\r\n/g, '\n')
      assert.equal(excerpts[index][2], source.split('\n').slice(reference.startLine - 1, reference.endLine).join('\n'), `${page.title}: ${reference.path}`)
      assert.ok(page.content.includes(`${reference.path}#L${reference.startLine}-L${reference.endLine}`), page.title)
    }
    assert.ok(!page.content.includes('章节已规划，正文待完善'), page.title)
  }
})

test('desktop lessons pin independently verified source excerpts without a desktop checkout', () => {
  const fixture = JSON.parse(readFileSync(resolve(siteRoot, 'tests/fixtures/desktop-source-excerpts.json'), 'utf8'))
  assert.match(fixture.commit, /^[a-f0-9]{40}$/)
  const key = item => `${item.commit}:${item.path}:${item.startLine}:${item.endLine}`
  const snapshots = new Map(fixture.excerpts.map(item => [key(item), item]))
  for (const page of readPages().filter(page => page.data.track === 'desktop')) {
    assert.equal(page.data.sourceBaseline, fixture.commit)
    const blocks = [...page.content.replace(/\r\n/g, '\n').matchAll(/```(rust|javascript)\n([\s\S]*?)\n```/g)]
    assert.ok(blocks.length >= 2, page.title)
    assert.equal(blocks.length, page.data.sourceExcerpts.length)
    for (const [index, reference] of page.data.sourceExcerpts.entries()) {
      assert.equal(reference.repository, 'desktop')
      const snapshot = snapshots.get(key(reference))
      assert.ok(snapshot, `${page.title}: audited source snapshot is missing`)
      assert.equal(blocks[index][2], snapshot.code)
      assert.equal(createHash('sha256').update(snapshot.code).digest('hex'), snapshot.excerptSha256)
      assert.ok(page.content.includes(`/blob/${reference.commit}/${reference.path}#L${reference.startLine}-L${reference.endLine}`))
    }
    for (const reference of page.data.sourceReferences) {
      assert.ok(reference.url.includes(`/blob/${fixture.commit}/`), page.title)
    }
    assert.ok(!page.content.includes('章节已规划，正文待完善'), page.title)
  }
})
