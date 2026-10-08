// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@clocky/clocky-client-test-runtime'
import type { TeamMemberReadinessRecord } from '@clocky/clocky-client-runtime/client'
import { MemberReadiness } from '../src/client/MemberReadiness.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

it('distinguishes unavailable observations from route refusal and shows details only when requested', () => {
  const translate = makeTranslate(en)
  const view = render(<MemberReadiness translate={translate} stale details />)
  expect(view.getByText(new RegExp(en['readiness.unavailable']))).toBeTruthy()
  expect(view.getByText(new RegExp(en['readiness.stale']))).toBeTruthy()
  expect(view.queryByText(en['readiness.advisory'])).toBeNull()
  const value: TeamMemberReadinessRecord = {
    participantId: 'member' as never, participation: 'active', state: 'route-unavailable',
    reasons: ['provider-unavailable'], configuration: 'worker-route', observationId: 'observation' as never, observedAt: 1,
  }
  view.rerender(<MemberReadiness translate={translate} value={value} details />)
  expect(view.getByText(en['readiness.reason.provider-unavailable'])).toBeTruthy()
  expect(view.getByText('worker-route')).toBeTruthy()
  expect(view.getByText('observation')).toBeTruthy()
  const { configuration: _configuration, ...ready } = value
  view.rerender(<MemberReadiness translate={translate} value={{ ...ready, state: 'ready', reasons: [] }} details />)
  expect(view.queryByText('worker-route')).toBeNull()
  expect(view.queryByText(en['readiness.reason.provider-unavailable'])).toBeNull()
  expect(view.getByText(en['readiness.advisory'])).toBeTruthy()
  view.rerender(<MemberReadiness translate={translate} value={ready} />)
  expect(view.queryByText('observation')).toBeNull()
  expect(view.queryByText(en['readiness.advisory'])).toBeNull()
})
