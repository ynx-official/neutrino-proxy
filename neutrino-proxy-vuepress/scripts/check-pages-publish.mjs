import { normalizeBase } from './routes.mjs'
import { validateDomain } from './deployment.mjs'

const base = normalizeBase(process.env.DOCS_BASE || '/')
const domain = validateDomain(process.env.DOCS_DOMAIN || '', base)

// Rehearsals may test a subpath; production uses the approved custom domain.
if (process.env.DOCS_PUBLISH === 'true' && (base !== '/' || !domain)) {
  throw new Error('Publishing to GitHub Pages requires DOCS_BASE=/ and a non-empty DOCS_DOMAIN')
}

console.log(`Pages parameters verified: base=${base}, domain=${domain || '(none)'}, publish=${process.env.DOCS_PUBLISH === 'true'}`)
