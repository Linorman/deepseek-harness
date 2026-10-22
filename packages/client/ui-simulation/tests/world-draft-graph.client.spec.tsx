// @vitest-environment jsdom
/** Private graph pages declare actual coverage and support layer navigation through ordinary keyboard controls. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorldDraftGraph } from '../src/client/WorldDraftGraph.tsx'
import { worldScenarioV1Schema } from '@clocky/clocky-simulation-scenario'
import definition from '../../../sdk/protocol/tests/fixtures/world-v1-definition.json'
import { makeTranslate } from '../../../test-support/client-runtime/src/translate.ts'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
it('bounds the visible graph and equivalent list, searches the owned draft and expands one selected unit', () => {
  const model = worldScenarioV1Schema.parse(definition)
  for (let index = 0; index < 100; index++) {
    model.entities.push({ id: `unit-${index}`, name: `Unit ${index}`, description: 'Owned unit', kind: 'organization', cognition: 'none' })
    model.organization.units.push({ id: `unit-${index}`, parentId: model.organization.rootId })
  }
  const command = vi.fn(async () => {}), changeLayout = vi.fn()
  const ui = render(<WorldDraftGraph definition={model} revision={3} disabled={false} changeLayout={changeLayout}
    command={command} t={makeTranslate(en) as never} />)
  expect(ui.getByText(/Showing 80 of/)).toBeDefined()
  expect(ui.container.querySelectorAll('[data-node-id]').length).toBeLessThanOrEqual(80)
  fireEvent.click(ui.getByRole('button', { name: en['world.author.nextWindow'] }))
  expect(ui.getByText(/saved revision 3/)).toBeDefined()
  fireEvent.change(ui.getByLabelText(en['world.author.graphSearch']), { target: { value: 'unit-99' } })
  expect(ui.getByText(/Showing 1 of 1/)).toBeDefined()
  fireEvent.click(ui.getByRole('button', { name: 'Unit 99 · unit-99' }))
  fireEvent.click(ui.getByRole('button', { name: en['world.author.childLayer'] }))
  fireEvent.change(ui.getByLabelText(en['world.author.graphSearch']), { target: { value: '' } })
  expect(ui.getByText(/Showing 1 of 1/)).toBeDefined()
  fireEvent.change(ui.getByLabelText('X'), { target: { value: '32' } })
  fireEvent.change(ui.getByLabelText('Y'), { target: { value: '-10' } })
  fireEvent.click(ui.getByRole('button', { name: en['world.author.layoutApply'] }))
  expect(changeLayout).toHaveBeenCalledWith([{ id: 'unit-99', x: 32, y: -10 }])
  expect(command).not.toHaveBeenCalled()
})

it.each(['object', 'environment', 'person-state'] as const)('keeps %s selectable for layout without creating personnel assignments', (kind) => {
  const model = worldScenarioV1Schema.parse(definition)
  const extra = kind === 'environment' ? { environment: { model: 'supply-seasonal/1', generation: 1, inventory: 10,
    committed: 4, capacity: 20, sourceLimit: 3, sinkLimit: 5, step: 1, lastTime: null } }
    : kind === 'person-state' ? { evolution: { personId: 'ceo', audience: ['ceo'], period: 10, versions: [] } } : {}
  const input = worldScenarioV1Schema.parse({ ...model, entities: [...model.entities,
    { id: 'non-person', name: 'Non-person', description: 'Non-cognitive object', cognition: 'none', kind, ...extra }] })
  const command = vi.fn(async () => {}), changeLayout = vi.fn()
  const ui = render(<WorldDraftGraph definition={input} revision={3} disabled={false} changeLayout={changeLayout}
    command={command} t={makeTranslate(en) as never} />)
  const node = ui.container.querySelector('[data-proxy-id="non-person"]')!
  expect(node.getAttribute('aria-label')).toContain(en['world.author.genericObject'])
  expect(node.getAttribute('aria-label')).not.toContain(en['world.section.people'])
  fireEvent.click(ui.getByRole('button', { name: 'Non-person · non-person' }))
  fireEvent.change(ui.getByLabelText(en['world.author.targetId']), { target: { value: input.organization.positions[0]!.id } })
  fireEvent.change(ui.getByLabelText(en['world.author.newId']), { target: { value: 'forbidden-assignment' } })
  const connect = ui.getByRole('button', { name: en['world.author.connectNode'] })
  expect(connect.hasAttribute('disabled')).toBe(true)
  fireEvent.click(connect)
  expect(command).not.toHaveBeenCalled()
  fireEvent.click(ui.getByRole('button', { name: en['world.author.layoutApply'] }))
  expect(changeLayout).toHaveBeenCalledOnce()
  expect(changeLayout.mock.calls[0]).toMatchObject([[{ id: 'non-person' }]])
  const person = input.entities.find(entity => entity.kind === 'person')!
  fireEvent.click(ui.getByRole('button', { name: `${person.name} · ${person.id}` }))
  expect(connect.hasAttribute('disabled')).toBe(false)
  fireEvent.click(connect)
  expect(command).toHaveBeenCalledWith({ kind: 'assignment/create', assignment: { id: 'forbidden-assignment',
    personId: person.id, positionId: input.organization.positions[0]!.id, validFrom: '0', validUntil: null } })
})
