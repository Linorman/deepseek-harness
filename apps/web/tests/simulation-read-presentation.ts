/** Rendered evidence for Simulation reads; preferences change through the shipped settings UI. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { expect } from 'vitest'
import type { NativeZoomEvidence } from './browser-native-zoom.ts'

/**
 * Exercise the same retained read page under both locales/themes and bounded window sizes.
 * @param page - Authenticated real Host page with an open Simulation read workspace.
 * @param output - Project-local evidence directory.
 * @param identity - Backend and read-page identity used in screenshot and measurement records.
 * @param setNativeZoom - Test-only Chromium native tab zoom controller, independently verified through tabs.getZoom.
 * @returns after restoring Chinese, light appearance and the original desktop viewport.
 */
export async function simulationReadPresentation(page: Page, output: string, identity: string,
  setNativeZoom: (page: Page, factor: 1 | 2 | 4) => Promise<NativeZoomEvidence>): Promise<void> {
  const workspace = page.locator('[data-simulation-workspace-page]')
  const initial = page.url()
  const evidence: unknown[] = []
  for (const locale of ['zh', 'en'] as const) {
    await page.setViewportSize({ width: 1440, height: 1000 }); await setNativeZoom(page, 1)
    if (locale === 'en') {
      await page.getByRole('button', { name: '设置', exact: true }).click()
      await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '中文', exact: true }).click()
      await page.getByRole('menuitem', { name: 'English', exact: true }).click()
      await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor()
      await page.keyboard.press('Escape')
    }
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: 1440, height: 1000 }); await setNativeZoom(page, 1)
      await page.getByRole('button', { name: locale === 'zh' ? '设置' : 'Settings', exact: true }).click()
      await page.getByRole('dialog', { name: locale === 'zh' ? '设置' : 'Settings', exact: true })
        .getByRole('button', { name: locale === 'zh' ? theme === 'light' ? '浅色' : '深色' : theme === 'light' ? 'Light' : 'Dark', exact: true }).click()
      await page.keyboard.press('Escape')
      await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe(theme === 'dark' ? '' : null)
      await workspace.getByRole('button', { name: locale === 'zh' ? '刷新' : 'Refresh', exact: true }).waitFor()
      for (const variant of [
        { viewport: { width: 1440, height: 1000 }, factor: 1 },
        { viewport: { width: 1280, height: 480 }, factor: 1 },
        { viewport: { width: 390, height: 844 }, factor: 1 },
        { viewport: { width: 1440, height: 1000 }, factor: 2 },
        ...locale === 'zh' && theme === 'light' ? [
          { viewport: { width: 1280, height: 720 }, factor: 1 as const },
          { viewport: { width: 1024, height: 768 }, factor: 1 as const },
          { viewport: { width: 320, height: 844 }, factor: 1 as const },
          { viewport: { width: 1280, height: 720 }, factor: 4 as const },
        ] : [],
      ] as const) {
        const { viewport, factor } = variant
        await page.setViewportSize(viewport)
        const zoom = await setNativeZoom(page, factor)
        expect(zoom.factor).toBeCloseTo(factor, 12)
        expect(zoom.width).toBeCloseTo(viewport.width / factor, 0)
        await expect.poll(async () => workspace.evaluate(element => element.getBoundingClientRect().width))
          .toBeGreaterThan(viewport.width / factor / 2)
        await page.evaluate(async () => {
          await Promise.allSettled(document.getAnimations()
            .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
            .map(animation => animation.finished))
        })
        await workspace.getByRole('heading', { level: 1 }).waitFor()
        expect(await page.locator('vite-error-overlay').count()).toBe(0)
        expect(page.url()).toBe(initial)
        if (factor === 4) {
          await page.locator('[data-clocky-navigation]').hover()
          await page.mouse.wheel(0, 1000)
          const settings = page.getByRole('button', { name: '设置', exact: true })
          await settings.scrollIntoViewIfNeeded()
          const bounds = await settings.boundingBox()
          expect(bounds !== null && bounds.y >= 0 && bounds.y + bounds.height <= zoom.height).toBe(true)
        }
        const measurements = await workspace.evaluate((element) => {
          const color = (raw: string) => {
            const components = raw.match(/[\d.]+/g)?.map(Number) ?? []
            return [components[0] ?? 0, components[1] ?? 0, components[2] ?? 0, components[3] ?? 1]
          }
          const blend = (front: number[], back: number[]) => front.slice(0, 3)
            .map((value, index) => value * front[3]! + back[index]! * (1 - front[3]!)).concat(1)
          const luminance = (rgb: number[]) => rgb.slice(0, 3).map((value) => {
            const linear = value / 255
            return linear <= .04045 ? linear / 12.92 : ((linear + .055) / 1.055) ** 2.4
          }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index]!, 0)
          const values = [...element.querySelectorAll<HTMLElement>('h1,h2,p,th,dt,dd,code,button,a')].filter((node) => {
            const box = node.getBoundingClientRect()
            return box.width > 0 && box.height > 0 && !node.closest('[disabled]')
              && [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && (child.textContent?.trim().length ?? 0) > 0)
          }).map((node) => {
            const ancestry: HTMLElement[] = []
            for (let current: HTMLElement | null = node; current !== null; current = current.parentElement) ancestry.unshift(current)
            const background = ancestry.reduce((result, ancestor) => blend(color(getComputedStyle(ancestor).backgroundColor), result),
              [255, 255, 255, 1])
            const style = getComputedStyle(node), foreground = blend(color(style.color), background)
            const a = luminance(foreground), b = luminance(background)
            const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
            const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700
            return { tag: node.tagName, text: node.textContent?.trim().slice(0, 80), color: style.color,
              background, ratio, minimum: large ? 3 : 4.5 }
          })
          return { pageWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, values }
        })
        expect(measurements.documentWidth).toBeLessThanOrEqual(measurements.pageWidth)
        expect(measurements.values.length).toBeGreaterThan(0)
        expect(measurements.values.filter(row => row.ratio + .01 < row.minimum)).toEqual([])
        const screenshot = `${identity}-${locale}-${theme}-${viewport.width}x${viewport.height}-${factor * 100}percent.png`
        await page.screenshot({ path: join(output, screenshot), animations: 'disabled' })
        evidence.push({ identity, url: initial, locale, theme, viewport, zoom, data: 'authorized retained read', screenshot, measurements })
      }
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  const animations = await workspace.evaluate(element => element.getAnimations({ subtree: true })
    .map(animation => animation.effect?.getComputedTiming().duration))
  expect(animations.filter(duration => typeof duration === 'number' && duration > 0)).toEqual([])
  await page.setViewportSize({ width: 1440, height: 1000 })
  const refresh = workspace.getByRole('button', { name: 'Refresh', exact: true })
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  let tabs = 0
  while (!await refresh.evaluate(element => element === document.activeElement) && tabs < 100) {
    await page.keyboard.press('Tab'); tabs++
  }
  expect(await refresh.evaluate(element => element === document.activeElement)).toBe(true)
  expect(tabs).toBeGreaterThan(0)
  const semantics = await workspace.ariaSnapshot()
  expect(semantics).toContain('heading')
  if (new URL(initial).searchParams.has('simulation')) expect(semantics).toContain('navigation')
  for (const button of await workspace.getByRole('button').all()) {
    const name = await button.getAttribute('aria-label') ?? await button.innerText()
    expect(name.trim().length).toBeGreaterThan(0)
  }
  const focus = await refresh.evaluate((element) => {
    const style = getComputedStyle(element)
    return { outline: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow }
  })
  expect(focus.outline !== 'none' && parseFloat(focus.outlineWidth) > 0 || focus.boxShadow !== 'none').toBe(true)
  await page.keyboard.press('Enter')
  await expect.poll(() => refresh.isEnabled()).toBe(true)
  evidence.push({ reducedMotion: true, animations, keyboard: 'Tab traversal to Refresh then Enter at native 200% zoom',
    zoom: await setNativeZoom(page, 2), tabs, focus, semantics })
  await setNativeZoom(page, 1)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('button', { name: 'Light', exact: true }).click()
  await settings.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('menuitem', { name: '中文', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await writeFile(join(output, `${identity}-presentation.json`), JSON.stringify(evidence, null, 2) + '\n')
}
