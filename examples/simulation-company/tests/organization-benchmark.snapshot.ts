/** Real deterministic organization workload and independent cold recovery. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const execute = promisify(execFile)
describe.each(['json', 'sqlite'])('%s organization benchmark', (backend) => {
  it('retains original debtors across daily role handoffs and conserves delivered inventory', async () => {
    await mkdir(resolve('.tmp'), { recursive: true })
    const directory = await mkdtemp(resolve('.tmp/simulation-organization-test-'))
    try {
      const { stdout } = await execute(process.execPath, ['--import', 'tsx/esm', 'scripts/benchmark-simulation.ts',
        '--backend', backend, '--workload', 'organization', '--entities', '8', '--departments', '2', '--managers', '2',
        '--days', '3', '--operations', '12', '--residents', '2', '--duration-ms', '30000', '--timeout-ms', '90000',
        '--sample-every', '4', '--entity-batch-size', '8', '--replay-page-size', '32', '--output', directory])
      const summary = JSON.parse(stdout) as { report: string; status: string }
      expect(summary.status).toBe('measured')
      const report = JSON.parse(await readFile(summary.report, 'utf8')) as { result: {
        completion: string
        employees: number
        managers: number
        departments: number
        simulatedDays: number
        issued: number
        completed: number
        pending: number
        decisions: number
        handoffs: number
        retainedDebtors: number
        policyCalls: number
        modelCalls: number
        publications: number
        peakResidents: number
        reportedTokens: number
        peakContextBytes: number
        replayEqual: boolean
        acceptedResponsibilitiesPreserved: boolean
      } }
      expect(report).toMatchObject({ version: 2, layer: 'deterministic-organization', coldExitCode: 0,
        coldRecovery: { replayEqual: true, modelCalls: 0, publications: 0 } })
      const { peakContextBytes, ...result } = report.result
      expect(peakContextBytes).toBeGreaterThan(0)
      expect(peakContextBytes).toBeLessThanOrEqual(65536)
      expect({ completion: result.completion, employees: result.employees, managers: result.managers, departments: result.departments,
        simulatedDays: result.simulatedDays, issued: result.issued, completed: result.completed, pending: result.pending,
        decisions: result.decisions, handoffs: result.handoffs, retainedDebtors: result.retainedDebtors, policyCalls: result.policyCalls,
        modelCalls: result.modelCalls, publications: result.publications,
        peakResidents: result.peakResidents, reportedTokens: result.reportedTokens,
        replayEqual: result.replayEqual, acceptedResponsibilitiesPreserved: result.acceptedResponsibilitiesPreserved }).toMatchSnapshot()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
