/** Product inspection exposes Team capabilities without private compatibility services. */
import { expect, it } from 'vitest'
import { EVENT_API, queryServiceApi } from '../src/api-catalog.ts'

it.each(['goals', 'subagents', 'workflowEngine'])('does not advertise private %s operations to the model', (key) => {
  expect(() => queryServiceApi(key)).toThrow(`no catalogued Service named "${key}"`)
})

it('retains Team inspection and excludes compatibility event contracts', () => {
  expect(queryServiceApi('teams')).toMatchObject({ mode: 'service', service: { key: 'teams' } })
  expect(EVENT_API.filter(event => /^(?:goal|subagent)\//.test(event.name))).toEqual([])
  for (const name of ['workflow/start', 'workflow/phase', 'workflow/log', 'workflow/agent-start', 'workflow/agent-end', 'workflow/end']) {
    expect(EVENT_API.some(event => event.name === name)).toBe(false)
  }
  expect(EVENT_API.some(event => event.name === 'workflow/extension-added')).toBe(true)
})
