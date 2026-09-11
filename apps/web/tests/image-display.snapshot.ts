// @vitest-environment jsdom
// Multimodal image surfaces over the BUILT client graph (the code-mode-fixture
// idiom: real bundles via AppWebEntry, keyless FixtureApiClient transport).
// Opens the fixture Team coordinator transcript whose turn 73 carries an image in BOTH a
// user message and an assistant message, and pins the product surfaces: the
// history ImageGallery loading real fixture bytes through the authorized
// sessions.attachment route, the single-click ImageLightbox, and the composer
// intake chain (paste → ordered thumbnail rail → image-only send enablement → remove).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

/** Open the fixture Team coordinator transcript. */
async function openFixtureCoordinator(): Promise<void> {
  const tasks = await screen.findByRole('region', { name: 'Tasks' }, { timeout: 10_000 })
  fireEvent.click(within(tasks).getByText('Demonstrate the fixture Team API.'))
  await waitFor(() => {
    expect(document.querySelector('[data-sample="bash"]')).not.toBeNull()
  }, { timeout: 10_000 })
}

/** Open the fixture Team coordinator and settle its resident interactions. */
async function coordinatorComposer(): Promise<HTMLTextAreaElement> {
  await openFixtureCoordinator()
  for (let index = 0; index < 3; index += 1) {
    fireEvent.click(await screen.findByRole('button', { name: 'Skip this question' }))
  }
  fireEvent.click(await screen.findByRole('button', { name: 'Allow once' }))
  return await screen.findByRole('textbox', {}, { timeout: 10_000 }) as HTMLTextAreaElement
}

it('renders the history image pair through the authorized attachment route and opens the lightbox', async () => {
  mountAssembledApp()
  await openFixtureCoordinator()

  // Both the user-side (align=end) and assistant-side (align=start) galleries
  // load real fixture bytes over sessions.attachment. jsdom provides
  // createObjectURL, so this environment MUST take the object-URL path — a
  // data: src here would mean the fallback ran where it should not.
  await waitFor(() => {
    if (document.querySelector('[data-align="end"] img') === null
      || document.querySelector('[data-align="start"] img') === null) {
      throw new Error('history image galleries missing')
    }
  }, { timeout: 10_000 })
  const galleryShape = (align: string) => [...document.querySelectorAll(`[data-align="${align}"] img`)]
    .map(img => ({ alt: img.getAttribute('alt'), scheme: img.getAttribute('src')?.split(':')[0] }))
  expect({ user: galleryShape('end'), assistant: galleryShape('start') }).toMatchInlineSnapshot(`
    {
      "assistant": [
        {
          "alt": "fixture-image.png",
          "scheme": "blob",
        },
      ],
      "user": [
        {
          "alt": "fixture-image.png",
          "scheme": "blob",
        },
      ],
    }
  `)
  const userImage = document.querySelector<HTMLElement>('[data-align="end"] img')!

  // A single click opens the original-size lightbox; Escape/close dismisses it.
  const frame = userImage.closest('button')
  if (frame === null) throw new Error('image frame button missing')
  fireEvent.click(frame)
  const lightbox = await screen.findByRole('dialog')
  expect(within(lightbox).getByRole('img').getAttribute('src')?.split(':')[0]).toBe('blob')
  fireEvent.click(within(lightbox).getByRole('button', { name: /Close/ }))
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

it('accepts pasted images into the composer rail in order and removes them', async () => {
  mountAssembledApp()
  const textarea = await coordinatorComposer()

  // Image-only send arming is pinned at package level (input-bar.spec.tsx);
  // this assembled lane pins the intake chain over the built graph.
  const image = new File([new Uint8Array([137, 80, 78, 71])], 'pasted.png', { type: 'image/png' })
  fireEvent.paste(textarea, {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
      getData: () => '',
    },
  })

  // The rail is an accessible group holding the draft thumbnail (queried via
  // DOM: jsdom's a11y-visibility computation hides the composer subtree).
  const rail = await waitFor(() => {
    const el = document.querySelector('[role="group"][aria-label="Pending images"]')
    if (el === null) throw new Error('attachment rail missing')
    return el
  }, { timeout: 5_000 })
  expect([...rail.querySelectorAll('img')].map(img => ({
    alt: img.getAttribute('alt'), scheme: img.getAttribute('src')?.split(':')[0],
  }))).toMatchInlineSnapshot(`
    [
      {
        "alt": "pasted.png",
        "scheme": "blob",
      },
    ]
  `)

  const second = new File([new Uint8Array([137, 80, 78, 71])], 'second.png', { type: 'image/png' })
  fireEvent.paste(textarea, {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => second }],
      getData: () => '',
    },
  })
  await waitFor(() => {
    expect([...rail.querySelectorAll('img')].map(img => img.getAttribute('alt')))
      .toEqual(['pasted.png', 'second.png'])
  })

  const remove = [...rail.querySelectorAll('button[aria-label^="Remove image"]')]
  if (remove.length !== 2) throw new Error('remove buttons missing')
  for (const button of remove) fireEvent.click(button)
  await waitFor(() => {
    expect(document.querySelector('[role="group"][aria-label="Pending images"]')).toBeNull()
  })

  // An unsupported file announces a transient toast (the inline strip is
  // gone) and the banner dismisses itself after its hold-and-fade lifetime.
  fireEvent.paste(textarea, {
    clipboardData: {
      items: [{ kind: 'file', type: 'text/plain', getAsFile: () => new File(['x'], 'notes.txt', { type: 'text/plain' }) }],
      getData: () => '',
    },
  })
  const unsupportedMessage = 'Only PNG, JPG, WebP, and GIF images are supported'
  const toast = await screen.findByText(unsupportedMessage)
  expect(toast.closest('[role="alert"]')).not.toBeNull()
  await waitFor(() => {
    expect(screen.queryByText(unsupportedMessage)).toBeNull()
  }, { timeout: 6_000 })
})

it('accepts a whole-page drop under the limits-labeled overlay and refuses an over-limit batch at intake', async () => {
  mountAssembledApp()
  const textarea = await coordinatorComposer()

  // A file drag anywhere over the page raises the full-viewport overlay whose
  // desc line carries the projected limits — copy that can only render after
  // the imageLimits projection crossed the real fixture transport.
  const image = new File([new Uint8Array([137, 80, 78, 71])], 'dropped.png', { type: 'image/png' })
  const dataTransfer = { types: ['Files'], files: [image], dropEffect: 'none' }
  fireEvent.dragEnter(document.body, { dataTransfer })
  const overlayCopy = await screen.findByText('Drag images here to add them')
  const overlay = overlayCopy.closest('[role="status"]')
  if (overlay === null) throw new Error('image drop overlay missing status role')
  await waitFor(() => {
    expect(overlay.textContent).toContain('Up to 20 images, 5MB each')
  })

  // Dropping on the transcript area (not the composer card) lands in the rail.
  fireEvent.drop(document.body, { dataTransfer })
  await waitFor(() => {
    const rail = document.querySelector('[role="group"][aria-label="Pending images"]')
    if (rail === null) throw new Error('attachment rail missing after page drop')
    expect([...rail.querySelectorAll('img')].map(img => img.getAttribute('alt'))).toEqual(['dropped.png'])
  }, { timeout: 5_000 })
  expect(screen.queryByText('Drag images here to add them')).toBeNull()

  // An intake that would exceed the projected per-message count is refused as
  // a whole batch at add time: the banner names the limit and the rail keeps
  // only the previously accepted thumbnail — no submit-time rollback.
  const batch = Array.from({ length: 20 }, (_, i) =>
    new File([new Uint8Array([137, 80, 78, 71])], `bulk-${String(i)}.png`, { type: 'image/png' }))
  fireEvent.paste(textarea, {
    clipboardData: {
      items: batch.map(file => ({ kind: 'file', type: 'image/png', getAsFile: () => file })),
      getData: () => '',
    },
  })
  const limitMessage = 'A message can include up to 20 images'
  const banner = await screen.findByText(limitMessage)
  expect(banner.closest('[role="alert"]')).not.toBeNull()
  const rail = document.querySelector('[role="group"][aria-label="Pending images"]')
  expect([...(rail?.querySelectorAll('img') ?? [])]).toHaveLength(1)
})

it('renders a host dimension rejection with the projected 2000px limit', async () => {
  mountAssembledApp('?fixture&fixturePrompt=reject')
  const textarea = await coordinatorComposer()
  const image = new File([new Uint8Array([137, 80, 78, 71])], 'too-wide.png', { type: 'image/png' })
  fireEvent.paste(textarea, {
    clipboardData: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
      getData: () => '',
    },
  })
  await waitFor(() => {
    expect(document.querySelector('[role="group"][aria-label="Pending images"]')).not.toBeNull()
  })
  fireEvent.keyDown(textarea, { key: 'Enter' })

  const message = 'Image sides must be at most 2000px; downscale it and try again'
  const toast = await screen.findByText(message)
  expect({ role: toast.closest('[role="alert"]')?.getAttribute('role'), text: toast.textContent }).toMatchInlineSnapshot(`
    {
      "role": "alert",
      "text": "Image sides must be at most 2000px; downscale it and try again",
    }
  `)
  expect(document.querySelector('[role="group"][aria-label="Pending images"]')).not.toBeNull()
})
