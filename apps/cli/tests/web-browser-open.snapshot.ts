/** Assembled keyless snapshot for the default `clocky web` browser handoff. */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const snapshotTempRoot = join(repoRoot, '.tmp', 'web-browser-open-snapshot')
const builtBin = join(repoRoot, 'apps/cli/lib/bin.js')
const frontendIndex = join(repoRoot, 'apps/web/dist/index.html')
const openerHook = new URL('./fixtures/web-browser-open/register.mjs', import.meta.url).href
const openingMessage = 'clocky web: opening the default browser; pass --no-open to disable'
const tempRoots: string[] = []
const builtArtifactsExist = existsSync(builtBin) && existsSync(frontendIndex)

if (process.env.CLOCKY_EXAMPLE_MODE === 'lib' && !builtArtifactsExist) {
  throw new Error('clocky web browser-open snapshot requires built CLI and Web artifacts in lib mode')
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface BrowserOpenRecord {
  url: string
  status: number
  handoffStatus: number | null
  cookieAttributes: boolean
  apiAuthenticated: boolean
  handoffConsumed: boolean
  bootManifest: boolean
  apiKeyPresent: boolean
  clockyHomePresent: boolean
}

function normalizeLocalUrl(url: string): string {
  return url.replace(/:\d+$/, ':{{port}}')
}

function normalizeHandoffUrl(url: string): string {
  return url.replace(/file:\/\/.*\/browser-handoffs\/handoff-[^/]+\/index\.html/u, 'file://{{root}}/browser-handoffs/handoff-{{id}}/index.html')
}

describe.skipIf(!builtArtifactsExist)('clocky web browser-open assembled snapshot', () => {
  it('hands the reachable page to the default browser after the shipped tree settles', async () => {
    mkdirSync(snapshotTempRoot, { recursive: true, mode: 0o700 })
    const root = mkdtempSync(join(snapshotTempRoot, 'clocky-web-browser-open-'))
    tempRoots.push(root)
    const result = await execa(process.execPath, [
      '--import', openerHook,
      builtBin,
      'web',
      '--port', '0',
    ], {
      cwd: root,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: 'keyless-browser-open-no-call',
        CLOCKY_AGENTS_HOME: join(root, '.agents'),
        CLOCKY_HOME: join(root, '.clocky'),
        CLOCKY_TELEMETRY_DISABLED: '1',
        NODE_NO_WARNINGS: '1',
        SSH_CONNECTION: '',
        SSH_TTY: '',
      },
      input: '',
      timeout: 30_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    const readyUrl = /clocky web: (http:\/\/[^\s]+)/u.exec(result.stdout)?.[1]
    const openLine = result.stdout.split('\n').find(line => line.startsWith('clocky browser-open: '))
    const opening = result.stdout.includes(openingMessage)
    if (readyUrl === undefined || openLine === undefined || !opening) {
      throw new Error(`clocky web browser-open evidence missing\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
    }
    const opened = JSON.parse(openLine.slice('clocky browser-open: '.length)) as BrowserOpenRecord

    expect({
      exitCode: result.exitCode,
      opening,
      readyUrl: normalizeLocalUrl(readyUrl),
      openedUrl: normalizeHandoffUrl(opened.url),
      status: opened.status,
      handoffStatus: opened.handoffStatus,
      cookieAttributes: opened.cookieAttributes,
      apiAuthenticated: opened.apiAuthenticated,
      handoffConsumed: opened.handoffConsumed,
      bootManifest: opened.bootManifest,
      apiKeyPresent: opened.apiKeyPresent,
      clockyHomePresent: opened.clockyHomePresent,
      stderr: result.stderr,
    }).toMatchInlineSnapshot(`
      {
        "apiAuthenticated": true,
        "apiKeyPresent": false,
        "bootManifest": true,
        "clockyHomePresent": false,
        "cookieAttributes": true,
        "exitCode": 0,
        "handoffConsumed": true,
        "handoffStatus": 303,
        "openedUrl": "file://{{root}}/browser-handoffs/handoff-{{id}}/index.html",
        "opening": true,
        "readyUrl": "http://127.0.0.1:{{port}}",
        "status": 200,
        "stderr": "",
      }
    `)
  })

  it('prints a credential-safe launcher reason while retaining the handoff document', async () => {
    mkdirSync(snapshotTempRoot, { recursive: true, mode: 0o700 })
    const root = mkdtempSync(join(snapshotTempRoot, 'clocky-web-browser-open-failure-'))
    tempRoots.push(root)
    const result = await execa(process.execPath, [
      '--import', openerHook,
      builtBin,
      'web',
      '--port', '0',
    ], {
      cwd: root,
      env: {
        ...process.env,
        BROWSER_OPEN_TEST_FAILURE: 'fixture desktop unavailable',
        DEEPSEEK_API_KEY: 'keyless-browser-open-no-call',
        CLOCKY_AGENTS_HOME: join(root, '.agents'),
        CLOCKY_BROWSER_OPEN_TEST_EXIT_ON_FAILURE: '1',
        CLOCKY_HOME: join(root, '.clocky'),
        CLOCKY_TELEMETRY_DISABLED: '1',
        NODE_NO_WARNINGS: '1',
        SSH_CONNECTION: '',
        SSH_TTY: '',
      },
      input: '',
      timeout: 30_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    const readyUrl = /clocky web: (http:\/\/[^\s]+)/u.exec(result.stdout)?.[1]
    const diagnostic = result.stderr.split(/\r?\n/u)
      .find(line => line.startsWith('web-app: could not open the default browser because '))
      ?.replace(/http:\/\/127\.0\.0\.1:\d+/u, 'http://127.0.0.1:{{port}}')
      .replace(/file:\/\/.*\/browser-handoffs\/handoff-[^/]+\/index\.html/u, 'file://{{root}}/browser-handoffs/handoff-{{id}}/index.html')

    expect({
      diagnostic,
      exitCode: result.exitCode,
      opened: result.stdout.includes('clocky browser-open: '),
      opening: result.stdout.includes(openingMessage),
      readyUrl: readyUrl === undefined ? undefined : normalizeLocalUrl(readyUrl),
    }).toMatchInlineSnapshot(`
      {
        "diagnostic": "web-app: could not open the default browser because fixture desktop unavailable; open file://{{root}}/browser-handoffs/handoff-{{id}}/index.html manually before it expires",
        "exitCode": 0,
        "opened": false,
        "opening": true,
        "readyUrl": "http://127.0.0.1:{{port}}",
      }
    `)
  })

  it('prints the host URL without launching a browser in a VS Code Remote SSH session', async () => {
    mkdirSync(snapshotTempRoot, { recursive: true, mode: 0o700 })
    const root = mkdtempSync(join(snapshotTempRoot, 'clocky-web-browser-open-ssh-'))
    tempRoots.push(root)
    const result = await execa(process.execPath, [
      '--import', openerHook,
      builtBin,
      'web',
      '--port', '0',
    ], {
      cwd: root,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: 'keyless-browser-open-no-call',
        CLOCKY_AGENTS_HOME: join(root, '.agents'),
        CLOCKY_BROWSER_OPEN_TEST_EXIT_ON_READY: '1',
        CLOCKY_HOME: join(root, '.clocky'),
        CLOCKY_TELEMETRY_DISABLED: '1',
        NODE_NO_WARNINGS: '1',
        SSH_CONNECTION: '10.0.0.2 55000 10.0.0.9 22',
        SSH_TTY: '',
        VSCODE_IPC_HOOK_CLI: '/tmp/vscode-ipc',
      },
      input: '',
      timeout: 30_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    const readyUrl = /clocky web: (http:\/\/[^\s]+)/u.exec(result.stdout)?.[1]

    expect({
      exitCode: result.exitCode,
      opening: result.stdout.includes(openingMessage),
      readyUrl: readyUrl === undefined ? undefined : normalizeLocalUrl(readyUrl),
      opened: result.stdout.includes('clocky browser-open: '),
      stderr: result.stderr,
    }).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "opened": false,
        "opening": false,
        "readyUrl": "http://127.0.0.1:{{port}}",
        "stderr": "",
      }
    `)
  })

  it('rejects a project browser command before starting the Web app', async () => {
    mkdirSync(snapshotTempRoot, { recursive: true, mode: 0o700 })
    const root = mkdtempSync(join(snapshotTempRoot, 'clocky-web-browser-open-env-'))
    tempRoots.push(root)
    writeFileSync(join(root, '.env'), 'BROWSER=./project-browser\n')
    const result = await execa(process.execPath, [
      '--import', openerHook,
      builtBin,
      'web',
      '--port', '0',
    ], {
      cwd: root,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: 'keyless-browser-open-no-call',
        CLOCKY_AGENTS_HOME: join(root, '.agents'),
        CLOCKY_HOME: join(root, '.clocky'),
        CLOCKY_TELEMETRY_DISABLED: '1',
        NODE_NO_WARNINGS: '1',
        SSH_CONNECTION: '',
        SSH_TTY: '',
      },
      input: '',
      timeout: 30_000,
      killSignal: 'SIGKILL',
      reject: false,
    })

    const diagnostic = result.stderr.split(/\r?\n/u)
      .find(line => line.startsWith('Error: clocky: '))
      ?.replace(/^Error: clocky: .*[/\\]\.env/u, 'clocky: {{root}}/.env')

    expect({
      diagnostic,
      exitCode: result.exitCode,
      opening: result.stdout.includes(openingMessage),
      opened: result.stdout.includes('clocky browser-open: '),
      ready: result.stdout.includes('clocky web: '),
    }).toMatchInlineSnapshot(`
      {
        "diagnostic": "clocky: {{root}}/.env sets "BROWSER", which only the launching environment may set (it decides how this process starts, where its code and instructions load from, or how it reaches the network); export BROWSER instead of putting it in a .env file",
        "exitCode": 1,
        "opened": false,
        "opening": false,
        "ready": false,
      }
    `)
  })
})
