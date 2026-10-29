import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { docsRoot, siteRoot, readPages } from './content.mjs'

const outDir = resolve(docsRoot, '.vitepress/dist')
const manifest = JSON.parse(readFileSync(resolve(outDir, 'site-manifest.json'), 'utf8'))
assert.equal(manifest.base, '/', 'Nginx example verifies a root-path build')
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 120000 }).trim()
let container
try {
  container = docker(['run', '-d', '--rm', '-p', '127.0.0.1::8080',
    '--mount', `type=bind,source=${outDir},target=/usr/share/nginx/html,readonly`,
    '--mount', `type=bind,source=${resolve(siteRoot, 'hosting/nginx.conf')},target=/etc/nginx/conf.d/default.conf,readonly`,
    'nginx:stable-alpine'])
  const address = docker(['port', container, '8080/tcp'])
  const origin = `http://${address}`
  const request = path => fetch(origin + path, { signal: AbortSignal.timeout(5000) })
  for (let attempt = 0; ; attempt++) {
    try { await request('/'); break } catch (error) {
      if (attempt === 19) throw error
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  let count = 0
  for (const page of readPages()) {
    for (const route of new Set([page.route, page.route.replace(/\/$/, '') || '/'])) {
      const response = await request(route)
      assert.equal(response.status, 200, route)
      assert.equal(new URL(response.url).origin, origin, 'Redirect must preserve the public host/port')
      assert.ok((await response.text()).includes(page.title), route)
      count++
    }
  }
  const missing = await request('/this-page-does-not-exist/')
  assert.equal(missing.status, 404)
  assert.ok((await missing.text()).includes('页面不存在'))
  const missingAsset = await request('/assets/does-not-exist.js')
  assert.equal(missingAsset.status, 404)
  console.log(`Nginx verified ${count} old URL forms and real page/asset 404 responses.`)
} finally {
  if (container) docker(['stop', container])
}
