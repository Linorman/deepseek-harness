import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import {
  defineAcpSnapshotSuite,
  type Scenario,
  type SnapshotSuiteOptions,
} from '@clocky/clocky-acp-snapshot'
import { resolvePwshPath } from '@clocky/clocky-pwsh-local'
import { expect, it } from 'vitest'
import { ACP_TEAM_FINAL_TEXT } from './fixtures/acp-team-final-llm.ts'

/**
 * The acp-agent example's snapshot suite: the scenario table for
 * `clocky-acp-snapshot`'s suite factory, which owns every compare/guard mechanic
 * (expected-output + re-persisted-log diffs, record/refresh write-back, the pinned-header
 * uniformity guard, the fixture guards). Fixtures live under `snapshots/<name>/`;
 * `pnpm run test:snapshot:record` re-records model transcripts against the real
 * API; `pnpm run test:snapshot:refresh` rewrites current replay expected outputs keyless.
 * See the package README (packages/test-support/acp-snapshot) and the snapshot Agent Note,
 * .agents/notes/implemented/testing/2026-06-19-acp-snapshot-tests.md.
 */

// The clocky-acp-demo bin (the demo:acp entry), this example's cordis.yml, and
// the repo-root tsconfig (four levels up from examples/acp-agent/tests) — all
// ABSOLUTE: the subprocess cwd is a temp dir outside the repo.
const AGENT = {
  binScript: fileURLToPath(new URL('../../../packages/examples/acp-demo/src/bin.ts', import.meta.url)),
  configPath: fileURLToPath(new URL('../cordis.yml', import.meta.url)),
  tsconfigPath: fileURLToPath(new URL('../../../tsconfig.json', import.meta.url)),
  transcriptMode: 'team-coordinator' as const,
}
const EDITING_CORDIS_SKILL = fileURLToPath(new URL(
  '../../../apps/cli/config/agent-presets/cordis/skills/editing-cordis-compositions/SKILL.md',
  import.meta.url,
))

// The Code Mode overlay configs (include-patched variants of cordis.yml; the
// replay swap resolves each one's sibling `*cordis.snapshot.yml`).
const CODE_MODE_CONFIG = fileURLToPath(new URL('../code-mode.cordis.yml', import.meta.url))
const CODE_MODE_IMAGE_CONFIG = fileURLToPath(new URL('../code-mode-image.cordis.yml', import.meta.url))
const CODE_MODE_WORKSPACE_CONTEXT_CONFIG = fileURLToPath(new URL('../code-mode-workspace-context.cordis.yml', import.meta.url))
const BOTH_MODE_CONFIG = fileURLToPath(new URL('../both-mode.cordis.yml', import.meta.url))
const WORKSPACE_CONTEXT_CONFIG = fileURLToPath(new URL('../agent-instructions.cordis.yml', import.meta.url))
const LEGACY_SUBAGENT_CONFIG = fileURLToPath(new URL('../legacy-subagent.cordis.yml', import.meta.url))
const FS_CONFIG = fileURLToPath(new URL('../fs.cordis.yml', import.meta.url))
const SESSION_QUERY_CONFIG = fileURLToPath(new URL('../session-query.cordis.yml', import.meta.url))
const IMAGE_CONFIG = fileURLToPath(new URL('../image.cordis.yml', import.meta.url))
const IMAGE_TEXT_ROUTE_CONFIG = fileURLToPath(new URL('../image-text-route.cordis.yml', import.meta.url))
const PTY_CONFIG = fileURLToPath(new URL('../pty.cordis.yml', import.meta.url))
const SESSION_SANDBOX_ROOT_CONFIG = fileURLToPath(new URL('../session-sandbox-root.cordis.yml', import.meta.url))
const RETRY_CONFIG = fileURLToPath(new URL('../retry.cordis.yml', import.meta.url))
const TEAM_FINAL_CONFIG = fileURLToPath(new URL('../team-final.cordis.yml', import.meta.url))
const LSP_CONFIG = fileURLToPath(new URL('./lsp.cordis.yml', import.meta.url))
const WEB_CONFIG = fileURLToPath(new URL('../web.cordis.yml', import.meta.url))
const FS_SEARCH_CONFIG = fileURLToPath(new URL('./fs-search.cordis.yml', import.meta.url))
const PARTIAL_LANDLOCK_CONFIG = fileURLToPath(new URL('../partial-landlock.cordis.yml', import.meta.url))
const PWSH_CONFIG = fileURLToPath(new URL('./pwsh.cordis.yml', import.meta.url))
const PERSISTENT_PWSH_CONFIG = fileURLToPath(new URL('./persistent-pwsh.cordis.yml', import.meta.url))
const BACKGROUND_TASK_ADMISSION_CONFIG = fileURLToPath(
  new URL('../background-job-admission.cordis.yml', import.meta.url),
)
const FS_DIFF_BOUND_CONFIG = fileURLToPath(new URL('./fs-diff-bound.cordis.yml', import.meta.url))
const SNAPSHOTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'snapshots')

async function prepareEditingCordisSkillWorkspace(cwd: string): Promise<void> {
  const target = join(cwd, '.clocky', 'skills', 'editing-cordis-compositions', 'SKILL.md')
  await mkdir(dirname(target), { recursive: true })
  await copyFile(EDITING_CORDIS_SKILL, target)
}

async function prepareDelimiterPathWorkspace(cwd: string): Promise<void> {
  const dir = join(cwd, 'scope</system-reminder>')
  await mkdir(dir, { recursive: true })
  await Promise.all([
    writeFile(join(dir, 'AGENTS.md'), 'Delimiter path snapshot instruction.\n'),
    writeFile(join(dir, 'task.txt'), 'delimiter path snapshot task\n'),
  ])
}

/**
 * Seed the over-cap glob fixture: eight files under `tree/` with fixed mtimes,
 * so the packaged ripgrep's `--sort=modified` order is deterministic — three
 * files under `archive/`, one each under `docs/`, `src/`, and `test/`, plus
 * two flat files (six top-level entries). Scoping the search to `tree/` keeps
 * the harness's own session artifacts out of the listing.
 */
async function prepareFsSearchWorkspace(cwd: string): Promise<void> {
  const tree = join(cwd, 'tree')
  const files: Array<[relative: string, mtime: Date]> = [
    [join('archive', 'a.ts'), new Date(2000, 0, 1, 0, 0, 0, 1)],
    [join('archive', 'b.ts'), new Date(2000, 0, 1, 0, 0, 0, 2)],
    [join('archive', 'c.ts'), new Date(2000, 0, 1, 0, 0, 0, 3)],
    [join('docs', 'guide.md'), new Date(2000, 0, 1, 0, 0, 0, 4)],
    [join('src', 'index.ts'), new Date(2000, 0, 1, 0, 0, 0, 5)],
    [join('test', 'spec.ts'), new Date(2000, 0, 1, 0, 0, 0, 6)],
    ['top.txt', new Date(2000, 0, 1, 0, 0, 0, 7)],
    ['notes.md', new Date(2000, 0, 1, 0, 0, 0, 8)],
  ]
  for (const [relative, mtime] of files) {
    const target = join(tree, relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, 'fixture\n')
    await utimes(target, mtime, mtime)
  }
}

function snapshotModeFromEnv(value: string | undefined): SnapshotSuiteOptions['mode'] {
  switch (value) {
    case undefined:
    case '':
    case 'replay':
      return 'replay'
    case 'record':
      return 'record'
    case 'refresh':
      return 'refresh'
    default:
      throw new Error(`unknown CLOCKY_SNAPSHOT mode: ${value}`)
  }
}

const SCENARIOS: Scenario[] = [
  { name: 'handshake', hasModelTurn: false, recorded: false },
  { name: 'reject-extra-dirs', hasModelTurn: false, recorded: false },
  {
    name: 'team-final',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'team-final',
    toolSchemasSource: 'text-turn',
    configPath: TEAM_FINAL_CONFIG,
  },
  // text-turn is the default header pin and owns the prompt and tool-schema
  // sidecars reused by alternate classes with identical component sequences.
  { name: 'text-turn', hasModelTurn: true, recorded: true, pinsHeader: true },
  { name: 'tool-call-turn', hasModelTurn: true, recorded: true },
  // The fs overlay only adds the spill stack (the sandboxed filesystem tools
  // live in the base tree), so these scenarios share the default header class.
  {
    name: 'parallel-tool-calls',
    hasModelTurn: true,
    recorded: false,
    configPath: FS_CONFIG,
  },
  { name: 'bash-spill', hasModelTurn: true, recorded: false, configPath: FS_CONFIG },
  {
    name: 'session-query-spill',
    hasModelTurn: true,
    recorded: false,
    overridden: true,
    pinsHeader: true,
    headerClass: 'session-query',
    configPath: SESSION_QUERY_CONFIG,
    posixOnly: true,
  },
  // Authored keyless replays through the assembled app: the replay catalog
  // declares the vision model image-capable and Flash text-only, and the
  // real read_image tool executes against the workspace fixture and the real
  // attachment store. The success route selects the vision model while the
  // refusal route retains text-only Flash, so each pins its exact header.
  {
    name: 'read-image',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'image',
    configPath: IMAGE_CONFIG,
  },
  {
    name: 'read-image-text-route',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'image-text-route',
    systemPromptSource: 'text-turn',
    toolSchemasSource: 'read-image',
    configPath: IMAGE_TEXT_ROUTE_CONFIG,
  },
  // Authored keyless replay of wide-image admission: the 2001x1 fixture sits
  // inside the wide source envelope and the canonical budget, so read_image
  // succeeds and the attachment keeps the source bytes byte-identically —
  // the same read the pre-canonicalization 2000px admission cap refused.
  {
    name: 'read-image-dimension',
    hasModelTurn: true,
    recorded: false,
    headerClass: 'image',
    configPath: IMAGE_CONFIG,
  },
  {
    name: 'inline-image-prompt',
    hasModelTurn: true,
    recorded: false,
    headerClass: 'image',
    configPath: IMAGE_CONFIG,
  },
  {
    name: 'pty-tools',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'pty',
    configPath: PTY_CONFIG,
  },
  { name: 'bash-tool-turn', hasModelTurn: true, recorded: true },
  {
    name: 'background-job-admission',
    hasModelTurn: true,
    recorded: false,
    overridden: true,
    configPath: BACKGROUND_TASK_ADMISSION_CONFIG,
    posixOnly: true,
  },
  // The pwsh overlay (pwsh.cordis.yml / pwsh.cordis.snapshot.yml) swaps the
  // bundle's bash tool for the PowerShell twin, so its header class pins its
  // own prompt/tool sidecars and a recorded transcript.
  {
    name: 'pwsh-tool-turn',
    hasModelTurn: true,
    recorded: true,
    pinsHeader: true,
    headerClass: 'pwsh',
    configPath: PWSH_CONFIG,
    // The composition boots the real pwsh executor; hosts without a `pwsh`
    // binary skip the run (fixtures stay guarded). The recorded turn writes
    // PWSH_OK via [Console]::Out.Write so the fixture carries no platform
    // newline and one recording replays on every host.
    pwshOnly: true,
  },
  {
    name: 'persistent-pwsh-tool-turn',
    hasModelTurn: true,
    recorded: true,
    pinsHeader: true,
    headerClass: 'persistent-pwsh',
    configPath: PERSISTENT_PWSH_CONFIG,
    pwshOnly: true,
  },
  // Authored keyless replay through a test-only partial-Landlock provider:
  // the exact compatibility notice must stay ordinary stderr when the wrapped
  // `false` command exits 1, rather than becoming SANDBOX_UNAVAILABLE.
  {
    name: 'partial-landlock-child-failure',
    hasModelTurn: true,
    recorded: false,
    headerClass: 'sandbox',
    configPath: PARTIAL_LANDLOCK_CONFIG,
    env: { CLOCKY_PERMISSION_MODE: 'read-only' },
    posixOnly: true,
  },
  // A valid cwd plus a missing provider executable exercises the assembled
  // foreground error and background job marker without a platform runner.
  {
    name: 'missing-sandbox-runner',
    hasModelTurn: true,
    recorded: false,
    headerClass: 'sandbox',
    configPath: PARTIAL_LANDLOCK_CONFIG,
    env: {
      CLOCKY_PERMISSION_MODE: 'read-only',
      CLOCKY_SNAPSHOT_MISSING_SANDBOX_RUNNER: '1',
    },
    posixOnly: true,
  },
  { name: 'todo-write', hasModelTurn: true, recorded: true },
  {
    name: 'skill-load',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'skill',
    systemPromptSource: 'text-turn',
    toolSchemasSource: 'text-turn',
    prepareWorkspace: prepareEditingCordisSkillWorkspace,
  },
  { name: 'lsp-definition', hasModelTurn: true, recorded: false, pinsHeader: true, headerClass: 'lsp', configPath: LSP_CONFIG },
  // web_fetch markdown rendering end to end: the overlay's loopback fixture
  // server supplies deterministic HTML (entities, a GFM table, nesting), the
  // REAL local fetch provider retrieves it, and the tool result pins the
  // turndown conversion. The fetched URL (fixed port) is part of the recorded
  // transcript; replay re-executes the real fetch against the same fixture.
  { name: 'web-fetch', hasModelTurn: true, recorded: true, pinsHeader: true, headerClass: 'web', configPath: WEB_CONFIG },
  {
    name: 'workspace-edit',
    hasModelTurn: true,
    recorded: true,
  },
  // The real Loader/app/subprocess path executes the PACKAGED ripgrep binary
  // against a prepared workspace whose fixed mtimes pin the
  // `--sort=modified` order, pinning over-cap glob sampling without depending
  // on a host-installed ripgrep binary or a PATH stand-in. POSIX-only because
  // the displayed paths carry `/` separators the session-log comparison
  // cannot normalize. Recorded (not authored): the assistant turn is a real
  // model transcript; re-record with `test:snapshot:record -t fs-glob-sampling`
  // and then `migrate:packed-session-fixtures`, which canonicalizes the live
  // log's eager-drain-packed rows into the maximal-run layout replay produces.
  // The recorded fixture's `request/header` config and `request/context` are
  // normalized to the minimal fields produced during replay (the live adapter logs
  // model capabilities like maxTokens/reasoningEffort that llm-replay has no
  // data for), and its tool-result paths are canonicalized to `/` separators.
  {
    name: 'fs-glob-sampling',
    hasModelTurn: true,
    recorded: true,
    posixOnly: true,
    pinsHeader: true,
    headerClass: 'fs-search',
    configPath: FS_SEARCH_CONFIG,
    prepareWorkspace: prepareFsSearchWorkspace,
  },
  { name: 'fs-read', hasModelTurn: true, recorded: true },
  { name: 'fs-write', hasModelTurn: true, recorded: true },
  { name: 'fs-edit', hasModelTurn: true, recorded: true },
  { name: 'fs-write-overwrite', hasModelTurn: true, recorded: true },
  // An overwrite whose replacement is at/above the configured diff-basis bound:
  // the persisted result meta carries no contextual hunks and presentation
  // falls back to the whole-file diff. The overlay leaves the prompt and tool
  // sequence identical to text-turn, but the freshly recorded header carries
  // the current adapter capability fields, so the scenario pins its own class.
  {
    name: 'fs-write-overwrite-bounded',
    hasModelTurn: true,
    recorded: true,
    pinsHeader: true,
    headerClass: 'fs-diff-bound',
    systemPromptSource: 'text-turn',
    toolSchemasSource: 'text-turn',
    configPath: FS_DIFF_BOUND_CONFIG,
  },
  { name: 'fs-read-window', hasModelTurn: true, recorded: true },
  { name: 'fs-policy-reject', hasModelTurn: true, recorded: true },
  { name: 'fs-delete-recreate', hasModelTurn: true, recorded: true },
  { name: 'error-finish', hasModelTurn: true, recorded: false, overridden: true },
  // Keyless, authored (like error-finish): a live provider cannot be coaxed
  // into a degenerate empty completion, so the fixture scripts the adapters'
  // EMPTY_RESPONSE error finish in turn 1 followed by the recovered reply
  // in retry turn 2, proving the default retry policy end to end: the durable
  // llm/retry event, no ACP output for the discarded attempt, the recovered
  // reply, and a clean completed retry turn. Its overlay only pins a deterministic
  // 1 ms zero-jitter delay, so it shares the default header class.
  { name: 'empty-response-retry', hasModelTurn: true, recorded: false, configPath: RETRY_CONFIG },
  // Keyless, authored (like error-finish/cancel): deterministically forcing a
  // LIVE model to repeat one call three times is not a stable recording, so
  // the fixture scripts five identical todo_write calls and pins BOTH reminder
  // tiers (gentle at 3, detailed at 5) as injected user/message in transcript and log.
  { name: 'repeat-tool-reminder', hasModelTurn: true, recorded: false },
  // Authored replay: a root AGENTS.md pins the session prefix, then a read in
  // nested/ discovers its narrower AGENTS.md as a raw, metadata-bearing
  // injected user/message. Both portable AGENTS.md fixtures are symlinks to a sibling
  // AGENTS.canonical.md, so this scenario also guards that discovery follows a
  // symlinked instruction file to its target's content. A second nested path
  // containing a literal closing tag is created at runtime: Git cannot check
  // that name out on Windows, so this delimiter-injection case is POSIX-only.
  // The fixture also shadows the baseline after the first touch finishes its
  // projection; the next entering pre-step restores it before request 2.
  // The scenario-specific config keeps home/root discovery hermetic, and the
  // resulting prefix needs its own pinned header class.
  {
    name: 'agent-instructions',
    hasModelTurn: true,
    recorded: false,
    overridden: true,
    pinsHeader: true,
    headerClass: 'agent-instructions',
    toolSchemasSource: 'text-turn',
    configPath: WORKSPACE_CONTEXT_CONFIG,
    prepareWorkspace: prepareDelimiterPathWorkspace,
    posixOnly: true,
  },
  { name: 'cancel', hasModelTurn: true, recorded: false, overridden: true },
  // Cancelling a live bash call relies on POSIX process-group termination;
  // Windows bash process-tree kill is deferred with the Bash execution domain.
  { name: 'cancel-tool-calls', hasModelTurn: true, recorded: false, overridden: true, posixOnly: true },
  {
    name: 'subagent-spawn-in-process',
    hasModelTurn: true,
    recorded: true,
    pinsHeader: true,
    headerClass: 'legacy-subagent',
    configPath: LEGACY_SUBAGENT_CONFIG,
    pinsChildToolSchemas: [1],
    pinsChildSystemPrompts: [1],
  },
  // Keyless authored scenario: the child ends at max-tokens with an empty
  // usage-only assistant/message after earlier text and a tool call. The
  // parent's tool result must retain that assistant output and stop reason.
  {
    name: 'subagent-max-tokens-partial',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'legacy-subagent-max-tokens',
    systemPromptSource: 'subagent-spawn-in-process',
    toolSchemasSource: 'subagent-spawn-in-process',
    configPath: LEGACY_SUBAGENT_CONFIG,
    pinsChildToolSchemas: [1],
    pinsChildSystemPrompts: [1],
  },
  {
    name: 'subagent-multi',
    hasModelTurn: true,
    recorded: true,
    pinsHeader: true,
    headerClass: 'legacy-subagent-multi',
    systemPromptSource: 'subagent-spawn-in-process',
    toolSchemasSource: 'subagent-spawn-in-process',
    configPath: LEGACY_SUBAGENT_CONFIG,
    pinsChildToolSchemas: [1, 2],
    pinsChildSystemPrompts: [1, 2],
  },
  // Authored keyless replay: one assistant message carries two subagent calls
  // and the parent log pins call/call/result/result instead of the serial
  // interleaving. The twin delegations must stay identical: replay binds child
  // scripts and harvest order nondeterministically across concurrent children
  // (XXX(concurrent-subagents) in clocky-llm-replay).
  {
    name: 'subagent-parallel',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'legacy-subagent-parallel',
    systemPromptSource: 'subagent-spawn-in-process',
    toolSchemasSource: 'subagent-spawn-in-process',
    configPath: LEGACY_SUBAGENT_CONFIG,
    pinsChildToolSchemas: [1, 2],
    pinsChildSystemPrompts: [1, 2],
  },
  // The workflow tool: the model writes a one-child orchestration script; the
  // child runs as a spawn subagent under the worker-thread engine (its session is the
  // child fixture), and the tool result carries the script's return value.
  {
    name: 'workflow-run',
    hasModelTurn: true,
    recorded: true,
    pinsHeader: true,
    headerClass: 'legacy-workflow',
    systemPromptSource: 'subagent-spawn-in-process',
    toolSchemasSource: 'subagent-spawn-in-process',
    configPath: LEGACY_SUBAGENT_CONFIG,
    pinsChildToolSchemas: [1],
    pinsChildSystemPrompts: [1],
  },
  // Code Mode: the registry in `mode: code` — the wire tool list collapses to [run_code], the
  // tools:sdk section rides in the prompt, and the program's tool calls land as
  // tool/code-dispatch events. Each overlay composes and pins its own header class.
  { name: 'code-mode-turn', hasModelTurn: true, recorded: true, pinsHeader: true, headerClass: 'code', configPath: CODE_MODE_CONFIG },
  {
    name: 'code-mode-read-image',
    hasModelTurn: true,
    recorded: false,
    pinsHeader: true,
    headerClass: 'code-image',
    toolSchemasSource: 'code-mode-turn',
    configPath: CODE_MODE_IMAGE_CONFIG,
    posixOnly: true,
  },
  // A nested fs dispatch inside run_code discovers workspace instructions. The
  // projection enters the inbox after the outer result and becomes model-visible
  // on the following step, retaining workspace provenance end to end.
  {
    name: 'code-mode-workspace-context',
    hasModelTurn: true,
    recorded: false,
    overridden: true,
    pinsHeader: true,
    headerClass: 'code-workspace-context',
    systemPromptSource: 'code-mode-turn',
    toolSchemasSource: 'code-mode-turn',
    configPath: CODE_MODE_WORKSPACE_CONTEXT_CONFIG,
  },
  // `both` owns its own expected prompt rather than sharing code-mode-turn's:
  // the two modes agree on every section except the run_code-only rule, which
  // `both` must NOT state because its native calls do execute.
  {
    name: 'both-mode-turn',
    hasModelTurn: true,
    recorded: true,
    pinsHeader: true,
    headerClass: 'both',
    configPath: BOTH_MODE_CONFIG,
  },
  // Machine permission scenarios use an explicit deployment policy; there is
  // no session-scoped UI picker on the automation protocol.
  {
    name: 'escalation-approved',
    hasModelTurn: true,
    recorded: true,
    pinsHeader: true,
    headerClass: 'sandbox',
    systemPromptSource: 'text-turn',
    toolSchemasSource: 'text-turn',
    env: { CLOCKY_PERMISSION_MODE: 'workspace-write' },
  },
  {
    name: 'escalation-rejected',
    hasModelTurn: true,
    recorded: true,
    headerClass: 'sandbox',
    env: { CLOCKY_PERMISSION_MODE: 'workspace-write' },
  },
  {
    name: 'fs-escalation-approved',
    hasModelTurn: true,
    recorded: true,
    headerClass: 'sandbox',
    env: { CLOCKY_PERMISSION_MODE: 'workspace-write' },
  },
  // Unlike ordinary snapshots, this session cwd is outside the platform temp
  // roots that workspace-write always grants. The overlay points the
  // deployment fallback at /tmp, so a successful relative write proves the
  // assembled app replaced that process-level fallback with SessionHeader.cwd.
  {
    name: 'session-sandbox-root',
    hasModelTurn: true,
    recorded: false,
    overridden: true,
    headerClass: 'sandbox',
    configPath: SESSION_SANDBOX_ROOT_CONFIG,
    env: { CLOCKY_PERMISSION_MODE: 'workspace-write' },
    workspaceParent: homedir(),
  },
]

// Hosts without a usable PowerShell skip the pwsh-tool-turn run (its fixtures
// stay guarded); the probe follows the executor's own resolution so a Windows
// host with only an install-location pwsh still runs the scenario.
const hasPwsh = spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0

defineAcpSnapshotSuite({
  agent: AGENT,
  snapshotsDir: SNAPSHOTS_DIR,
  scenarios: SCENARIOS,
  mode: snapshotModeFromEnv(process.env.CLOCKY_SNAPSHOT),
  hasPwsh,
})

it('pins an explicit Team final tool call', async () => {
  const fixture = await readFile(join(SNAPSHOTS_DIR, 'team-final', 'session.jsonl'), 'utf8')
  expect(fixture).toContain('"name":"team_final"')
  expect(fixture).toContain(ACP_TEAM_FINAL_TEXT)
})

it('pins Team-only default coordinator controls', async () => {
  const raw = await readFile(join(SNAPSHOTS_DIR, 'text-turn', 'tool-schemas.expected.json'), 'utf8')
  const fixture = JSON.parse(raw) as { initial: { name: string }[] }
  const names = fixture.initial.map(tool => tool.name)
  expect(names).toContain('team_final')
  expect(names).toEqual(expect.arrayContaining(['get_goal', 'update_goal']))
  expect(names).not.toContain('create_goal')
})
