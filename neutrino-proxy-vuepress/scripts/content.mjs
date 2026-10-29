import { readdirSync, readFileSync } from 'node:fs'
import { resolve, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { normalizePermalink } from './routes.mjs'

export const siteRoot = fileURLToPath(new URL('../', import.meta.url))
export const docsRoot = resolve(siteRoot, 'docs')

export function readPages(root = docsRoot) {
  function walk(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      if (entry.name.startsWith('.') || entry.name === 'public') return []
      const path = resolve(directory, entry.name)
      return entry.isDirectory() ? walk(path) : /\.md$/i.test(entry.name) ? [path] : []
    })
  }
  return walk(root).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })).map(path => {
    const source = relative(root, path).replaceAll('\\', '/')
    const { data, content } = matter(readFileSync(path, 'utf8'))
    if (source !== 'index.md' && !data.permalink) throw new Error(`Missing permalink: ${source}`)
    return {
      source, data, content,
      title: data.title || data.heroText || basename(source, '.md'),
      route: normalizePermalink(source === 'index.md' ? '/' : data.permalink),
    }
  })
}

export function buildSidebar(pages, { stripRoot = false } = {}) {
  const items = []
  for (const page of pages.filter(page => page.route !== '/' && !page.data.archivesPage)) {
    let level = items
    for (const folder of page.source.split('/').slice(stripRoot ? 1 : 0, -1)) {
      const text = folder.replace(/^\d+\./, '')
      let group = level.find(item => item.text === text && item.items)
      if (!group) {
        group = { text, collapsed: false, items: [] }
        level.push(group)
      }
      level = group.items
    }
    level.push({ text: page.title, link: page.route })
  }
  return items
}
