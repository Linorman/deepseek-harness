/** Actual administrative dialogs across locale, theme, window size and native browser zoom. */
import type { Locator, Page } from 'playwright'
import { expect } from 'vitest'
import type { NativeZoomEvidence } from './browser-native-zoom.ts'
import { teamAppearance, teamEvidence } from './team-acceptance-support.ts'

/**
 * Reopen the same explicit administration view without submitting it or discarding its raw input.
 * @param page - Authenticated real Host browser page.
 * @param output - Test-owned project-local artifact directory.
 * @param identity - Stable operation/data identity for screenshots and measured evidence.
 * @param open - Actual user-facing operation that opens one named dialog.
 * @param setZoom - Test-only controller using Chromium's native tabs.setZoom/getZoom API.
 * @returns after restoring desktop Chinese/light, without any mutation submission.
 */
export async function adminDialogMatrix(page: Page, output: string, identity: string,
  open: () => Promise<Locator>, setZoom: (page: Page, factor: 1 | 2 | 4) => Promise<NativeZoomEvidence>): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const locale of ['zh', 'en'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: 1440, height: 1000 }); await setZoom(page, 1)
      await teamAppearance(page, locale, theme)
      for (const variant of [
        { viewport: { width: 1440, height: 1000 }, factor: 1 },
        { viewport: { width: 1280, height: 480 }, factor: 1 },
        { viewport: { width: 390, height: 844 }, factor: 1 },
        { viewport: { width: 1440, height: 1000 }, factor: 2 },
        ...locale === 'zh' && theme === 'light' ? [
          { viewport: { width: 320, height: 844 }, factor: 1 as const },
          { viewport: { width: 1280, height: 720 }, factor: 4 as const },
        ] : [],
      ] as const) {
        await page.setViewportSize(variant.viewport)
        const nativeZoom = await setZoom(page, variant.factor)
        const dialog = await open()
        await dialog.waitFor({ state: 'visible' })
        expect(await dialog.getAttribute('aria-label') || await dialog.getAttribute('aria-labelledby')).toBeTruthy()
        expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(true)
        expect(await dialog.ariaSnapshot()).toContain('dialog')
        const input = dialog.getByRole('textbox').first()
        if (await input.count() > 0) {
          await input.scrollIntoViewIfNeeded()
          const field = await input.boundingBox(), card = await dialog.boundingBox()
          expect(field !== null && card !== null && field.y >= card.y && field.y + field.height <= card.y + card.height).toBe(true)
        }
        const title = await dialog.evaluate(element => element.getAttribute('aria-label')
          || document.getElementById(element.getAttribute('aria-labelledby') ?? '')?.textContent?.trim())
        if (title === undefined || title === null) throw new Error('Named administrative modal has no title')
        const trigger = await page.evaluateHandle(label => [...document.querySelectorAll('button')]
          .find(button => !button.closest('dialog') && button.textContent?.trim() === label), title)
        expect(await trigger.evaluate(button => button !== undefined)).toBe(true)
        expect(await dialog.evaluate(element => ({ reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
          running: element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length })))
          .toEqual({ reduced: true, running: 0 })
        const name = `${identity}-${locale}-${theme}-${variant.viewport.width}x${variant.viewport.height}-${variant.factor * 100}`
        await teamEvidence(page, dialog, output, name, { locale, theme, nativeZoom, data: identity,
          assertion: 'real named modal, current retained operation, measured contrast and reachable controls' })
        for (let index = 0; index < 18; index++) {
          await page.keyboard.press(index % 2 === 0 ? 'Tab' : 'Shift+Tab')
          const focus = await dialog.evaluate(element => ({ within: element.contains(document.activeElement),
            chrome: document.activeElement === document.body, modal: element.matches(':modal') }))
          expect(focus.within || focus.chrome && focus.modal).toBe(true)
        }
        await page.keyboard.press('Escape')
        await expect.poll(() => dialog.count()).toBe(0)
        expect(await trigger.evaluate(button => button === document.activeElement)).toBe(true)
        await trigger.dispose()
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await setZoom(page, 1)
  await teamAppearance(page, 'zh', 'light')
}
