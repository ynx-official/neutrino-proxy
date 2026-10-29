import { test, expect } from '@playwright/test'
import { readPages } from '../../scripts/content.mjs'

for (const document of readPages()) {
  test(`direct access and hydration: ${document.route}`, async ({ page, request }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const response = await page.goto(`.${document.route}`)
    expect(response.status()).toBe(200)
    if (document.route !== '/') {
      const slashless = await request.get(`.${document.route.slice(0, -1)}`)
      expect(slashless.status()).toBe(200)
      expect(await slashless.text()).toContain(document.title)
    }
    await expect(page).toHaveTitle(new RegExp(document.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    await expect(page.locator('.VPContent')).toBeVisible()
    await expect(page.locator('.VPNavBarSearch button')).toBeEnabled()
    await page.getByRole('button', { name: '搜索文档', exact: true }).click()
    await expect(page.locator('#localsearch-input')).toBeVisible()
    await page.keyboard.press('Escape')
    expect(errors).toEqual([])
  })
}

test('old slashless URL and numeric heading bookmark', async ({ page }) => {
  const response = await page.goto('./pages/793dcb#_2、部署服务')
  expect(response.status()).toBe(200)
  await expect(page.locator('[id="_2、部署服务"]')).toBeVisible()
})

test('Chinese search, result navigation and empty state', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: '搜索文档', exact: true }).click()
  const search = page.locator('#localsearch-input')
  await search.fill('服务端配置')
  await expect(page.locator('.VPLocalSearchBox a').filter({ hasText: '服务端配置' }).first()).toBeVisible()
  await page.locator('.VPLocalSearchBox a').filter({ hasText: '服务端配置' }).first().click()
  await expect(page).toHaveURL(/pages\/f2d0f1/)
  await page.getByRole('button', { name: '搜索文档', exact: true }).click()
  await search.fill('qzxqzxqzxqzxqzxqzx')
  await expect(page.getByText('没有找到相关文档')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(search).toBeHidden()
})

test('mobile navigation, appearance and horizontal bounds', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./pages/793dcb/')
  await page.getByRole('button', { name: '文档目录' }).click()
  await page.locator('.VPSidebar').getByRole('link', { name: '关于端口', exact: true }).click()
  await expect(page).toHaveURL(/pages\/68badb/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/mobile-docs.png', fullPage: true })
})

test('desktop theme, code copy and image zoom', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./pages/5b9bef/')
  const code = page.locator('div[class*="language-"]').first()
  await code.hover()
  await code.locator('button.copy').click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('docker run')
  await page.getByRole('switch', { name: '切换为深色' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.goto('./pages/793dcc/')
  await page.locator('.vp-doc img').first().click()
  await expect(page.locator('.medium-zoom-image--opened')).toBeVisible()
  await page.locator('.medium-zoom-image--opened').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  await page.keyboard.press('Escape')
  await expect(page.locator('.medium-zoom-image--opened')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/desktop-docs-dark.png' })
})

test('home and missing page', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('link', { name: '开始使用', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const logos = page.locator('.friends-item-img')
  expect(await logos.count()).toBeGreaterThan(20)
  for (const logo of await logos.all()) {
    const box = await logo.boundingBox()
    expect(box.width).toBeLessThanOrEqual(160)
    expect(box.height).toBeLessThanOrEqual(60)
  }
  await page.screenshot({ path: 'test-results/home.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/home-mobile.png', fullPage: true })
  await page.goto('./404.html')
  await expect(page.getByText('页面不存在', { exact: true })).toBeVisible()
})
