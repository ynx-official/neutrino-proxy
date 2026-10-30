// Directory indexes preserve VuePress permalinks on ordinary static hosts.
export function normalizePermalink(value) {
  if (typeof value !== 'string' || !/^\/(?!\/)[^?#%\\]*$/.test(value) ||
      value.split('/').some(segment => segment === '.' || segment === '..') || value.includes('//')) {
    throw new Error(`Invalid permalink: ${value}`)
  }
  return value === '/' ? '/' : `${value.replace(/\/$/, '')}/`
}

export function normalizeBase(value = '/') {
  return normalizePermalink(value)
}

export function buildRewrites(pages) {
  const routes = new Set()
  const rewrites = {}
  for (const page of pages) {
    const route = page.route.endsWith('.html') ? normalizePermalink(page.route).slice(0, -1) : normalizePermalink(page.route)
    if (routes.has(route)) throw new Error(`Duplicate route: ${route}`)
    routes.add(route)
    const destination = route.endsWith('.html') ? `${route.slice(1, -5)}.md`
      : route === '/' ? 'index.md' : `${route.slice(1)}index.md`
    if (destination !== page.source) rewrites[page.source] = destination
  }
  return rewrites
}
