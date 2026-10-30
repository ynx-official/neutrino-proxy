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
    const nativeRoute = source === 'index.md' ? '/'
      : source.endsWith('/index.md') ? `/${source.slice(0, -8)}` : `/${source.slice(0, -3)}.html`
    return {
      source, data, content,
      title: data.title || data.hero?.name || content.match(/^#\s+(.+)$/m)?.[1] || basename(source, '.md'),
      route: data.permalink ? normalizePermalink(data.permalink) : nativeRoute,
    }
  })
}
