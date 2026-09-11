// @vitest-environment jsdom
// The Team-owned composer boundary over the BUILT client graph (real bundles
// via AppWebEntry, keyless FixtureApiClient transport): the fixture Team opens
// its coordinator transcript, where generic Session command controls are
// unavailable. A slash-looking image message therefore uses the authenticated
// Team channel path and clears only after Team admission succeeds.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

/** Open the fixture Team coordinator and settle its resident interactions. */
async function coordinatorComposer(): Promise<HTMLTextAreaElement> {
  const tasks = await screen.findByRole('region', { name: 'Tasks' }, { timeout: 10_000 })
  fireEvent.click(within(tasks).getByText('Demonstrate the fixture Team API.'))
  await waitFor(() => {
    expect(document.querySelector('[data-sample="bash"]')).not.toBeNull()
  }, { timeout: 10_000 })
  for (let index = 0; index < 3; index += 1) {
    fireEvent.click(await screen.findByRole('button', { name: 'Skip this question' }))
  }
  fireEvent.click(await screen.findByRole('button', { name: 'Allow once' }))
  return await screen.findByRole('textbox', {}, { timeout: 10_000 }) as HTMLTextAreaElement
}

/** Paste one tiny PNG into the composer and wait for its rail thumbnail. */
async function pasteImage(textarea: HTMLTextAreaElement, name: string): Promise<void> {
  const image = new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' })
  fireEvent.paste(textarea, {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
      getData: () => '',
    },
  })
  await waitFor(() => {
    const rail = document.querySelector('[role="group"][aria-label="Pending images"]')
    if (rail === null) throw new Error('attachment rail missing')
    expect([...rail.querySelectorAll('img')].map(img => img.getAttribute('alt'))).toContain(name)
  }, { timeout: 5_000 })
}

it('fences generic command controls and routes slash-looking image text through Team', async () => {
  mountAssembledApp()
  const textarea = await coordinatorComposer()
  expect(screen.getByRole('button', { name: 'Commands' }).getAttribute('disabled')).not.toBeNull()
  expect(screen.queryByLabelText(/^Access mode/)).toBeNull()
  await pasteImage(textarea, 'ref.png')

  // Team-owned coordinators do not adjudicate generic slash commands. The
  // leading slash remains ordinary Team-channel text and the image crosses
  // the same authenticated postInput admission as any other content block.
  fireEvent.change(textarea, { target: { value: '/echo hello' } })
  fireEvent.keyDown(textarea, { key: 'Enter' })

  await waitFor(() => {
    expect(textarea.value).toBe('')
    expect(document.querySelector('[role="group"][aria-label="Pending images"]')).toBeNull()
  }, { timeout: 5_000 })
  expect([...document.querySelectorAll('[role="alert"]')]
    .some(candidate => candidate.textContent?.includes('image attachments') ?? false)).toBe(false)
})
