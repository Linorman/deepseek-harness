/** Browser evidence for Team layout, semantic feedback and actual rendered text contrast. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright'
import { expect } from 'vitest'
import type { NativeZoomEvidence } from './browser-native-zoom.ts'

/** Change the shipped preferences through their user-facing controls. */
export async function teamAppearance(page: Page, locale: 'zh' | 'en', theme: 'light' | 'dark'): Promise<void> {
  await page.getByRole('button', { name: /^(设置|Settings)$/, exact: true }).click()
  const settings = page.getByRole('dialog', { name: /^(设置|Settings)$/, exact: true })
  await settings.getByRole('button', { name: theme === 'dark' ? /^(深色|Dark)$/ : /^(浅色|Light)$/ }).click()
  const current = await settings.getByRole('button', { name: /^(中文|English)$/ }).textContent()
  if (current !== (locale === 'zh' ? '中文' : 'English')) {
    await settings.getByRole('button', { name: /^(中文|English)$/ }).click()
    await page.getByRole('menuitem', { name: locale === 'zh' ? '中文' : 'English', exact: true }).click()
  }
  await page.getByRole('dialog', { name: locale === 'zh' ? '设置' : 'Settings', exact: true }).waitFor()
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe(theme === 'dark' ? '' : null)
  await page.keyboard.press('Escape')
}

/** Capture rendered colors with ancestor backgrounds composited to the document canvas. */
export async function teamEvidence(page: Page, target: Locator, output: string, name: string,
  state: { locale: string; theme: string; data: string; assertion: string; nativeZoom?: NativeZoomEvidence }): Promise<void> {
  await target.waitFor({ state: 'visible' })
  // Theme attributes update before finite background/color transitions settle.
  // Measure the same presentation the screenshot records, including the
  // reduced-motion checkpoint for already-running transitions.
  await target.evaluate(async (root) => { await Promise.allSettled(root.getAnimations({ subtree: true })
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished)) })
  const measurement = await target.evaluate((root) => {
    type Color = [number, number, number, number]
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) throw new Error('Rendered contrast requires the browser color compositor')
    const colors = new Map<string, Color>()
    const rgba = (value: string): Color => {
      const retained = colors.get(value)
      if (retained !== undefined) return retained
      // Computed color-mix values use CSS Color 4's color(srgb ...) form;
      // its channels are fractions, unlike rgb()'s byte channels. Let the
      // browser normalize every supported CSS color into sRGB pixels.
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = value
      context.fillRect(0, 0, 1, 1)
      const pixel = context.getImageData(0, 0, 1, 1).data
      const result: Color = [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]! / 255]
      colors.set(value, result)
      return result
    }
    const over = (front: Color, back: Color): Color => {
      const a = front[3] + back[3] * (1 - front[3])
      return [0, 1, 2].map(index => (front[index]! * front[3] + back[index]! * back[3] * (1 - front[3])) / a)
        .concat(a) as Color
    }
    const luminance = (color: Color) => color.slice(0, 3).map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0)
    const samples = [...root.querySelectorAll<HTMLElement>('h1,h2,h3,p,th,label,button,span,dt,dd,[role="status"],[role="alert"]')]
      .filter(element => element.getClientRects().length > 0 && (element.textContent?.trim().length ?? 0) > 0
        && !element.closest('[disabled],[aria-hidden="true"]') && !element.querySelector('button,label,p,span,dt,dd'))
      .map((element) => {
        const style = getComputedStyle(element)
        let background: Color = [255, 255, 255, 1]
        const ancestors: HTMLElement[] = []
        for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) ancestors.unshift(node)
        for (const node of ancestors) background = over(rgba(getComputedStyle(node).backgroundColor), background)
        const foreground = over(rgba(style.color), background)
        const light = luminance(foreground), dark = luminance(background)
        const ratio = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05)
        const large = Number.parseFloat(style.fontSize) >= 24
          || Number.parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700
        return { text: element.textContent?.trim().slice(0, 100), color: style.color, background,
          ratio, required: large ? 3 : 4.5, role: element.getAttribute('role'), tag: element.tagName }
      })
    const unnamedControls = [...root.querySelectorAll<HTMLElement>('button,input:not([type="hidden"]),textarea,select,[role="button"]')]
      .filter(element => element.getClientRects().length > 0).filter((element) => {
        const references = element.getAttribute('aria-labelledby')?.split(/\s+/)
          .map(id => document.getElementById(id)?.textContent ?? '').join('')
        const labels = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
          ? [...element.labels ?? []].map(label => label.textContent).join('') : ''
        const name = element.getAttribute('aria-label') || references || labels || element.getAttribute('title')
          || (element.tagName === 'BUTTON' || element.getAttribute('role') === 'button' ? element.textContent : '')
        return !name?.trim()
      }).map(element => ({ tag: element.tagName, type: element.getAttribute('type'), id: element.id }))
    return { innerWidth, innerHeight, devicePixelRatio, darkTheme: document.body.hasAttribute('data-ds-dark-theme'),
      documentWidth: document.documentElement.scrollWidth,
      targetWidth: root.clientWidth, targetScrollWidth: root.scrollWidth, samples, unnamedControls }
  })
  await page.screenshot({ path: join(output, `${name}.png`), animations: 'disabled' })
  await writeFile(join(output, `${name}.json`), JSON.stringify({ ...state, viewport: page.viewportSize(), ...measurement }, null, 2) + '\n')
  expect(measurement.documentWidth).toBeLessThanOrEqual(measurement.innerWidth)
  expect(measurement.samples.length).toBeGreaterThan(0)
  expect(measurement.unnamedControls).toEqual([])
  expect(measurement.samples.filter(sample => sample.ratio + 0.01 < sample.required)).toEqual([])
}

/** Traverse a native dialog using only keyboard input and verify background focus exclusion. */
export async function teamModalKeyboard(page: Page, dialog: Locator, opener: Locator): Promise<void> {
  await opener.focus()
  await page.keyboard.press('Enter')
  await dialog.waitFor({ state: 'visible' })
  expect(await dialog.getAttribute('aria-labelledby') || await dialog.getAttribute('aria-label')).toBeTruthy()
  for (let index = 0; index < 24; index++) {
    await page.keyboard.press('Tab')
    const focus = await dialog.evaluate(element => ({ inside: element.contains(document.activeElement),
      browserChrome: document.activeElement === document.body && element.matches(':modal'),
      tag: document.activeElement?.tagName, name: document.activeElement?.getAttribute('aria-label') }))
    // Native Chromium exposes BODY while its own chrome has focus; no background application control receives it.
    expect(focus.inside || focus.browserChrome, JSON.stringify(focus)).toBe(true)
    if (focus.browserChrome) continue
    expect(await dialog.evaluate(() => {
      const focused = document.activeElement
      if (!(focused instanceof HTMLElement) || !focused.matches(':focus-visible')) return false
      const style = getComputedStyle(focused)
      if (Number.parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none' || style.boxShadow !== 'none') return true
      const wrapper = focused.parentElement
      return focused instanceof HTMLInputElement && wrapper?.matches(':focus-within') === true
        && Number.parseFloat(getComputedStyle(wrapper).borderWidth) > 0
    })).toBe(true)
  }
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  expect(await opener.evaluate(element => element === document.activeElement)).toBe(true)
}
