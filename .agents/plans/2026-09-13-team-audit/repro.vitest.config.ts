import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin,vitestExecArgv } from '../../../vitest.shared.ts'
export default defineConfig({plugins:[tsconfigPaths({projects:['./tsconfig.base.json']}),standardDecoratorPlugin()],test:{pool:'forks',execArgv:vitestExecArgv,include:['.agents/plans/2026-09-13-team-audit/*-repro.spec.ts'],setupFiles:['./scripts/test-invariants.ts','./scripts/test-dom.ts']}})
