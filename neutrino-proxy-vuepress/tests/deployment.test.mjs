import test from 'node:test'
import assert from 'node:assert/strict'
import { validateDomain } from '../scripts/deployment.mjs'

test('a custom domain is explicit and only applies to root deployments', () => {
  assert.equal(validateDomain('', '/neutrino-proxy/'), '')
  assert.equal(validateDomain('Docs.Example.com', '/'), 'docs.example.com')
  for (const domain of ['https://docs.example.com', 'docs.example.com/path', 'docs.example.com\nother.com', '-docs.example.com']) {
    assert.throws(() => validateDomain(domain, '/'), /DOCS_DOMAIN/)
  }
  assert.throws(() => validateDomain('docs.example.com', '/neutrino-proxy/'), /DOCS_BASE/)
})
