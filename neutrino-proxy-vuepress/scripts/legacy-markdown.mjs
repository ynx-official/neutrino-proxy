// VuePress 1.9.2 @vuepress/shared-utils (MIT): preserve existing heading bookmarks.
// https://unpkg.com/@vuepress/shared-utils@1.9.2/lib/slugify.js
export function legacySlugify(text) {
  return text.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’–—<>,.?/]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase()
}
