import original from '../../../vitest.config.ts'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  ...original,
  test: {
    ...original.test,
    projects: undefined,
    include: ['.agents/plans/2026-09-13-team-audit/continuation-regression.spec.ts'],
    maxWorkers: 1,
  },
})
