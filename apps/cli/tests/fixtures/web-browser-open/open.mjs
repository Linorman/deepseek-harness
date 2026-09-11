import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const handoffProbe = `
const { writeFileSync } = require('node:fs')
const marker = process.argv[1]
const helperPid = Number(process.argv[2])
setTimeout(() => {
  let helperAlive = true
  if (process.platform === 'win32') {
    try {
      process.kill(helperPid, 0)
    } catch {
      helperAlive = false
    }
  }
  if (helperAlive) writeFileSync(marker, '')
}, 50)
`

function handoffField(html, name) {
  const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(html)
  if (match === null || match[1] === undefined) throw new Error(`browser handoff has no ${name} field`)
  return match[1]
}

async function openHandoff(url) {
  const handoffPath = fileURLToPath(url)
  const html = readFileSync(handoffPath, 'utf8')
  const credential = handoffField(html, 'credential')
  const formAction = /<form[^>]+action="([^"]+)"/u.exec(html)?.[1]
  const handoffId = handoffField(html, 'handoffId')
  if (formAction === undefined) throw new Error('browser handoff has no form action')
  const bootstrap = await fetch(formAction, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ credential, handoffId }),
    redirect: 'manual',
  })
  const setCookie = bootstrap.headers.get('set-cookie')
  if (bootstrap.status !== 303 || setCookie === null) throw new Error(`browser handoff bootstrap failed with HTTP ${bootstrap.status}`)
  const cookie = setCookie.split(';', 1)[0]
  const location = bootstrap.headers.get('location')
  if (location !== '/') throw new Error(`browser handoff redirected to ${JSON.stringify(location)}`)
  const origin = new URL(formAction)
  const page = await fetch(new URL(location, origin), { headers: { cookie } })
  const api = await fetch(new URL('/api/team.list', origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'browser-open-authenticated-list',
      method: 'team.list',
      payload: {},
    }),
  })
  let apiBody
  try {
    apiBody = await api.json()
  } catch {
    apiBody = undefined
  }
  let handoffConsumed = false
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!existsSync(handoffPath)) {
      handoffConsumed = true
      break
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return {
    url,
    status: page.status,
    handoffStatus: bootstrap.status,
    cookieAttributes: /Path=\/api/i.test(setCookie) && /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie),
    apiAuthenticated: api.status === 200 && apiBody?.result?.ok === true,
    handoffConsumed,
    bootManifest: (await page.text()).includes('__CLOCKY_BOOT__'),
  }
}

export default async function open(url) {
  if (process.env.BROWSER_OPEN_TEST_FAILURE !== undefined) {
    throw new Error(process.env.BROWSER_OPEN_TEST_FAILURE)
  }
  const opened = url.startsWith('file:') ? await openHandoff(url) : await (async () => {
    const response = await fetch(url)
    const html = await response.text()
    return {
      url,
      status: response.status,
      handoffStatus: null,
      cookieAttributes: false,
      apiAuthenticated: false,
      handoffConsumed: false,
      bootManifest: html.includes('__CLOCKY_BOOT__'),
    }
  })()
  console.log(`clocky browser-open: ${JSON.stringify({
    ...opened,
    apiKeyPresent: process.env.DEEPSEEK_API_KEY !== undefined,
    clockyHomePresent: process.env.CLOCKY_HOME !== undefined,
  })}`)
  // The Windows launcher writes the server-exit marker only while its helper
  // remains alive, so the assembled test detects an early helper exit.
  const launcher = spawn(process.execPath, [
    '--eval', handoffProbe,
    '--', join(process.cwd(), `.clocky-browser-open-${process.ppid}`), String(process.pid),
  ], { stdio: 'ignore' })
  launcher.unref()
  return launcher
}
