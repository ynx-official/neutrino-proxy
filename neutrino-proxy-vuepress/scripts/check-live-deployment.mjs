import assert from 'node:assert/strict'

const site = new URL(process.env.DOCS_TEST_URL)
assert.equal(site.protocol, 'https:', 'Live verification requires HTTPS')
assert.equal(site.pathname, '/', 'The custom-domain site must use the root path')

async function get(path, options = {}) {
  return fetch(new URL(path, site), { signal: AbortSignal.timeout(30000), ...options })
}

const manifestResponse = await get('/site-manifest.json')
assert.equal(manifestResponse.status, 200)
const manifest = await manifestResponse.json()
assert.equal(manifest.domain, site.hostname)
assert.equal(manifest.base, '/')
assert.ok(manifest.pages.some(page => page.route === '/pages/793dcb/'))

for (const path of ['/release-check-missing-page/', '/assets/release-check-missing-file.js']) {
  assert.equal((await get(path)).status, 404, `${path} must return a real 404`)
}

const httpURL = new URL('/pages/793dcb/?release-check=https', site)
httpURL.protocol = 'http:'
const redirect = await fetch(httpURL, { redirect: 'manual', signal: AbortSignal.timeout(30000) })
assert.ok([301, 308].includes(redirect.status), 'HTTP must permanently redirect to HTTPS')
const target = new URL(redirect.headers.get('location'), httpURL)
assert.equal(target.protocol, 'https:')
assert.equal(target.host, site.host)
assert.equal(target.pathname, httpURL.pathname)
assert.equal(target.search, httpURL.search)

console.log(`Live deployment verified: ${site.origin}, ${manifest.pages.length} published pages, HTTPS redirect and real 404s`)
