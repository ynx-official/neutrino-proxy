import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function validateDomain(domain, base) {
  if (!domain) return ''
  if (base !== '/' || !/^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,63}$/i.test(domain)) {
    throw new Error('DOCS_DOMAIN must be a hostname and requires DOCS_BASE=/')
  }
  return domain.toLowerCase()
}

export function writeDeploymentFiles(outDir, pages, base, domain) {
  writeFileSync(resolve(outDir, '.nojekyll'), '')
  if (domain) writeFileSync(resolve(outDir, 'CNAME'), `${domain}\n`)
  writeFileSync(resolve(outDir, 'site-manifest.json'), JSON.stringify({
    generator: 'vitepress@1.6.4', base, domain,
    pages: pages.map(({ source, route, title }) => ({ source, route, title })),
  }, null, 2) + '\n')
}
