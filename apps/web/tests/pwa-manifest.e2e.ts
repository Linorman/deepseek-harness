import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'Clocky',
    short_name: 'Clocky',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/favicon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    }],
  })
})

it('ships a robot favicon that switches to a light mark under dark color scheme', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'favicon.svg'), 'utf8')
  // The light robot colors must live inside the dark-scheme media query,
  // so the icon stays slate in light mode and gains contrast in dark mode.
  expect(favicon).toMatch(/@media \(prefers-color-scheme: dark\)\s*{\s*\.stroke\s*{[^}]*stroke:\s*#cbd5e1/i)
  expect(favicon).toContain('.fill { fill: #475569; }')
  expect(favicon).toContain('<path d="M12 5V2.75"/>')
  expect(favicon.match(/<circle class="fill"/g)).toHaveLength(3)
})
