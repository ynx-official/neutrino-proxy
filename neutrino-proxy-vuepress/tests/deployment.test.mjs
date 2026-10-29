import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validateDomain } from '../scripts/deployment.mjs'

test('a custom domain is explicit and only applies to root deployments', () => {
  assert.equal(validateDomain('', '/neutrino-proxy/'), '')
  assert.equal(validateDomain('Docs.Example.com', '/'), 'docs.example.com')
  for (const domain of ['https://docs.example.com', 'docs.example.com/path', 'docs.example.com\nother.com', '-docs.example.com']) {
    assert.throws(() => validateDomain(domain, '/'), /DOCS_DOMAIN/)
  }
  assert.throws(() => validateDomain('docs.example.com', '/neutrino-proxy/'), /DOCS_BASE/)
})

function checkPublish(publish, base, domain) {
  return spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/check-pages-publish.mjs', import.meta.url))], {
    encoding: 'utf8',
    env: { ...process.env, DOCS_PUBLISH: publish, DOCS_BASE: base, DOCS_DOMAIN: domain },
  })
}

test('a rehearsal can validate a repository subpath without publishing or a domain', () => {
  const result = checkPublish('false', '/neutrino-proxy/', '')
  assert.equal(result.status, 0, result.stderr)
})

test('a production release requires an explicit custom domain at the root', () => {
  for (const [base, domain] of [['/', ''], ['/neutrino-proxy/', 'docs.example.com'], ['/', 'https://docs.example.com']]) {
    const result = checkPublish('true', base, domain)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /DOCS_DOMAIN|DOCS_BASE/)
  }
})

test('a production release accepts a valid custom domain at the root', () => {
  const result = checkPublish('true', '/', 'docs.example.com')
  assert.equal(result.status, 0, result.stderr)
})
