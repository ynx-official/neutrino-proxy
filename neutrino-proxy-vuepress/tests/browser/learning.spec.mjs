import { test, expect } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`source learning navigation, draft and source references at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./')
    if (width < 768) {
      await page.getByRole('button', { name: 'mobile navigation', exact: true }).click()
      await page.locator('.VPNavScreen').getByRole('link', { name: '源码学习', exact: true }).click()
    } else {
      await page.locator('.VPNavBarMenu').getByRole('link', { name: '源码学习', exact: true }).click()
    }
    await expect(page).toHaveURL(/\/learn\/$/)
    await expect(page.locator('.vp-doc h1')).toHaveText('源码学习目录与学习路线')
    await expect(page.locator('.vp-doc')).toContainText('12 个专题、60 篇章节')
    await page.locator('.vp-doc').getByRole('link', { name: '08.06 定时重连 可见性与并发边界', exact: true }).click()
    await expect(page).toHaveURL(/\/learn\/client-reconnection\/$/)
    await expect(page.locator('.vp-doc')).toContainText('章节已规划，正文待完善')
    await expect(page.locator('.vp-doc')).toContainText('reconnect')
    await expect(page.locator('.vp-doc strong').filter({ hasText: '计划实验' })).toHaveCount(1)
    await expect(page.locator('.vp-doc td').first()).toHaveText('client / ProxyClientService.java')
    const source = page.locator('.vp-doc a[href*="/neutrino-proxy/blob/"]').first()
    await expect(source).toHaveAttribute('href', /github\.com\/ynx-official\/neutrino-proxy\/blob\/[a-f0-9]{40}\//)
    if (width < 768) await page.getByRole('button', { name: '文档目录', exact: true }).click()
    const sidebar = page.locator('.VPSidebar')
    await expect(sidebar.getByRole('link')).toHaveCount(62)
    await expect(sidebar).not.toContainText('安装部署')
    const protocol = sidebar.getByRole('link', { name: '06.02 编码器如何计算长度并写入字段', exact: true })
    await protocol.scrollIntoViewIfNeeded()
    await protocol.click()
    await expect(page).toHaveURL(/\/learn\/protocol-encoder\/$/)
    if (width < 768) await expect(page.locator('.VPBackdrop')).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/learning-${width}.png`, fullPage: true })
  })
}
