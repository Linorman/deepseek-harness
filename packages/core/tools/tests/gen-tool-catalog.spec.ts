/**
 * Guarantee tests for the tool-schema catalog generator (`scripts/gen-tool-catalog.ts`).
 */

import { describe, expect, it } from 'vitest'
import {
  assertManifestComplete,
  assertToolsHarvested,
  collectToolCatalog,
  render,
  type ToolCatalog,
  type ToolPackage,
} from '../../../../scripts/gen-tool-catalog.ts'

/** JSON Schema shape enough to reach the values AST extraction can't. */
interface JsonSchema {
  type: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  enum?: string[]
  required?: string[]
}

describe('gen-tool-catalog collectToolCatalog', () => {
  it('boots every model-facing tool package and harvests its schemas', async () => {
    const catalog = await collectToolCatalog()
    const names = catalog.flatMap(entry => entry.schemas.map(s => s.name)).sort()
    expect(names).toEqual([
      'ask_user_question', 'bash', 'bash', 'cordis_define', 'cordis_inspect_list',
      'cordis_inspect_query', 'cordis_inspect_self', 'cordis_run', 'cordis_stop',
      'cordis_undefine', 'create_goal', 'edit', 'exit_plan_mode', 'get_goal', 'get_goal', 'glob', 'grep',
      'job_kill', 'job_list', 'job_output',
      'lsp', 'pwsh', 'pwsh',
      'read', 'read_image', 'run_code', 'schedule_create', 'schedule_delete',
      'schedule_list', 'session_event_read', 'session_event_search',
      'session_event_trace', 'session_search', 'session_trace', 'skill',
      'str_replace_editor', 'team_channel_summarize', 'team_final', 'team_goal_phase', 'team_message', 'team_task_cancel', 'team_task_delegate', 'team_task_heartbeat', 'team_task_integrate', 'team_task_list', 'team_task_propose_owner', 'team_task_report', 'team_task_review', 'team_task_start', 'team_task_wait', 'team_task_watch', 'team_worker_pool_set', 'team_workflow_start', 'team_workflow_task_cancel', 'team_workflow_wait', 'terminal_close', 'terminal_list',
      'terminal_open', 'terminal_read', 'terminal_send', 'terminal_signal', 'todo_write',
      'update_goal', 'update_goal', 'web_fetch', 'web_search', 'write',
    ])
    // Every tool carries a JSON-Schema `parameters` object (what the model sees).
    for (const entry of catalog) {
      for (const schema of entry.schemas) {
        expect((schema.parameters as unknown as JsonSchema).type).toBe('object')
      }
    }
  })

  it('resolves a runtime-spread enum to its literal members (the payoff over AST)', async () => {
    const catalog = await collectToolCatalog()
    const todo = catalog
      .flatMap(entry => entry.schemas)
      .find(s => s.name === 'todo_write')
    // `todo-todo` writes `enum: [...STATUSES]` — a source AST would see the
    // spread, not the values. Booting yields the runtime enum literals.
    const status = (((todo?.parameters as unknown as JsonSchema).properties?.todos)?.items)?.properties?.status
    expect(status?.enum).toEqual(['pending', 'in_progress', 'completed'])
  })

  it('attributes each harvested tool with its registering plugin source', async () => {
    const catalog = await collectToolCatalog()
    const bash = catalog.find(entry => entry.pkg === '@clocky/clocky-tool-bash')
    expect(bash?.sources.bash).toBe('packages/shell/tool-bash/src/index.ts')
    expect(catalog.some(entry => entry.pkg === '@clocky/clocky-tool-subagent-control')).toBe(false)
    const teamTask = catalog.find(entry => entry.pkg === '@clocky/clocky-tool-team-task')
    expect(teamTask?.sources).toEqual({
      team_task_cancel: 'packages/team/tool-team-task/src/index.ts',
      team_task_delegate: 'packages/team/tool-team-task/src/index.ts',
      team_task_list: 'packages/team/tool-team-task/src/index.ts',
      team_task_propose_owner: 'packages/team/tool-team-task/src/index.ts',
      team_task_start: 'packages/team/tool-team-task/src/index.ts',
      team_task_wait: 'packages/team/tool-team-task/src/index.ts',
      team_task_watch: 'packages/team/tool-team-task/src/index.ts',
      team_worker_pool_set: 'packages/team/tool-team-task/src/index.ts',
      team_workflow_start: 'packages/team/tool-team-task/src/index.ts',
      team_workflow_task_cancel: 'packages/team/tool-team-task/src/index.ts',
      team_workflow_wait: 'packages/team/tool-team-task/src/index.ts',
    })
    const team = catalog.find(entry => entry.pkg === '@clocky/clocky-tool-team')
    expect(team?.sources.team_task_integrate).toBe('packages/team/tool-team/src/index.ts')
    const teamGoal = catalog.find(entry => entry.pkg === '@clocky/clocky-tool-team-goal')
    expect(teamGoal?.sources).toEqual({
      get_goal: 'packages/team/tool-team-goal/src/index.ts',
      team_goal_phase: 'packages/team/tool-team-goal/src/index.ts',
      update_goal: 'packages/team/tool-team-goal/src/index.ts',
    })
  })

  it('harvests search tools without depending on the generator process PATH', async () => {
    const oldPath = process.env.PATH
    try {
      process.env.PATH = ''
      const catalog = await collectToolCatalog()
      const search = catalog.find(entry => entry.pkg === '@clocky/clocky-tool-fs-search')
      expect(search?.schemas.map(s => s.name).sort()).toEqual(['glob', 'grep'])
    } finally {
      if (oldPath === undefined) delete process.env.PATH
      else process.env.PATH = oldPath
    }
  })

  it('omits private compatibility tools from the product catalog', async () => {
    const catalog = await collectToolCatalog()
    expect(catalog.some(entry => entry.pkg === '@clocky/clocky-tool-subagent')).toBe(false)
    expect(catalog.some(entry => entry.pkg === '@clocky/clocky-tool-workflow')).toBe(false)
    expect(catalog.flatMap(entry => entry.schemas.map(schema => schema.name))).not.toEqual(expect.arrayContaining([
      'interrupt_agent', 'list_agents', 'ralph', 'report', 'send_message', 'subagent', 'workflow',
    ]))
  })
})

describe('gen-tool-catalog assertManifestComplete', () => {
  it('passes when the manifest lists every on-disk tool package (the default)', () => {
    expect(() => { assertManifestComplete() }).not.toThrow()
  })

  it('throws, naming the omitted package, when a tool package is missing from the manifest', () => {
    // An empty manifest scanned against the real tree: every `tool-*` package
    // is unlisted, so the guard must fire and name them.
    expect(() => { assertManifestComplete([]) }).toThrow(/not in the boot manifest/)
    expect(() => { assertManifestComplete([]) }).toThrow(/tool-bash/)
  })
})

describe('gen-tool-catalog assertToolsHarvested', () => {
  const entry: ToolPackage = {
    pkg: '@clocky/clocky-tool-demo',
    dir: 'tool-demo',
    source: 'packages/demo/tool-demo/src/index.ts',
    requires: ['ctx.tools', 'ctx.somethingUnmounted'],
    writes: ['tool/result'],
    mount: () => Promise.resolve(),
  }

  it('accepts a boot that registered at least one tool', () => {
    expect(() => { assertToolsHarvested(entry, 1) }).not.toThrow()
  })

  it('throws, naming the package and its requirements, when a boot registers nothing', () => {
    // The failure this guards is silent by construction: the package is in the
    // manifest, its plugin merely stays PENDING on an unmounted service, and the
    // catalog would ship without its tools while every gate stays green.
    expect(() => { assertToolsHarvested(entry, 0) }).toThrow(/@clocky\/clocky-tool-demo booted without registering a single tool/)
    expect(() => { assertToolsHarvested(entry, 0) }).toThrow(/ctx.somethingUnmounted/)
  })
})

describe('gen-tool-catalog render', () => {
  it('emits a package heading, a tool heading, and a json schema fence', () => {
    const catalog: ToolCatalog = [
      {
        pkg: '@clocky/clocky-tool-demo',
        sources: { demo: 'packages/demo/tool-demo/src/index.ts' },
        requires: ['ctx.tools'],
        writes: ['tool/result'],
        schemas: [{ name: 'demo', description: 'A demo tool.', parameters: { type: 'object', properties: {} } }],
      },
    ]
    const md = render(catalog)
    expect(md).toContain('| `@clocky/clocky-tool-demo` | `demo` | `ctx.tools` | `tool/result` |')
    expect(md).toContain('## `@clocky/clocky-tool-demo`')
    expect(md).toContain('### `demo`')
    expect(md).toContain('A demo tool.')
    expect(md).toContain('```json')
    expect(md).toContain('Source: [`packages/demo/tool-demo/src/index.ts`]')
  })
})
