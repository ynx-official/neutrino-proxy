import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { parseHTML } from 'linkedom'
import MarkdownIt from 'markdown-it'
import { readPages, docsRoot } from './content.mjs'
import { legacySlugify } from './legacy-markdown.mjs'
import { normalizeBase } from './routes.mjs'

const outDir = resolve(docsRoot, '.vitepress/dist')
const pages = readPages()
const base = normalizeBase(process.env.DOCS_BASE || '/')
const manifest = JSON.parse(readFileSync(resolve(outDir, 'site-manifest.json'), 'utf8'))
assert.equal(manifest.base, base, 'Build base must match verification base')
assert.equal(manifest.pages.length, pages.length)
assert.ok(existsSync(resolve(outDir, '.nojekyll')))
const errors = []
const documents = new Map()
let checked = 0

function outputFile(pathname) {
  let path = decodeURIComponent(pathname)
  if (!path.startsWith(base)) throw new Error(`URL escapes deployment base: ${path}`)
  path = path.slice(base.length)
  const file = resolve(outDir, path || 'index.html')
  if (path.endsWith('/')) return resolve(file, 'index.html')
  if (existsSync(file) && extname(file)) return file
  if (existsSync(resolve(file, 'index.html'))) return resolve(file, 'index.html')
  return `${file}.html`
}

function documentFor(file) {
  if (!documents.has(file)) documents.set(file, parseHTML(readFileSync(file, 'utf8')).document)
  return documents.get(file)
}

for (const page of [...pages, { route: '/404.html', title: '404', content: '' }]) {
  const url = new URL(base + page.route.slice(1), 'https://docs.invalid')
  const file = outputFile(url.pathname)
  assert.ok(existsSync(file), `Missing static page: ${page.route}`)
  const document = documentFor(file)
  assert.ok(document.title.includes(page.title), `Wrong title: ${page.route}`)
  const ids = new Set([...document.querySelectorAll('[id]')].map(node => node.id))
  // Old heading bookmarks must remain available, including Chinese/numeric headings.
  const seen = new Map()
  const tokens = new MarkdownIt({ html: true }).parse(page.content, {})
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].type !== 'heading_open') continue
    const inline = tokens[index + 1]
    const text = inline.children.filter(token => ['text', 'code_inline'].includes(token.type)).map(token => token.content).join('')
    const slug = legacySlugify(text)
    const count = seen.get(slug) || 0
    seen.set(slug, count + 1)
    const id = count ? `${slug}-${count}` : slug
    if (!ids.has(id)) errors.push(`${page.route}: missing old heading #${id}`)
  }
  for (const element of document.querySelectorAll('[href], [src]')) {
    const value = element.getAttribute('href') || element.getAttribute('src')
    if (!value || /^(data:|mailto:|tel:|javascript:)/i.test(value)) continue
    let target
    try { target = new URL(value, url) } catch { errors.push(`${page.route}: invalid URL ${value}`); continue }
    if (target.origin !== url.origin) continue
    checked++
    try {
      const targetFile = outputFile(target.pathname)
      if (!existsSync(targetFile)) throw new Error('missing file')
      if (target.hash && extname(targetFile) === '.html') {
        const id = decodeURIComponent(target.hash.slice(1))
        if (id && !documentFor(targetFile).getElementById(id)) throw new Error(`missing anchor #${id}`)
      }
    } catch (error) { errors.push(`${page.route}: ${value}: ${error.message}`) }
  }
}
if (errors.length) {
  console.error([...new Set(errors)].join('\n'))
  process.exitCode = 1
} else {
  console.log(`Verified ${pages.length} pages, legacy heading anchors and ${checked} local links/assets (base: ${base}).`)
}
