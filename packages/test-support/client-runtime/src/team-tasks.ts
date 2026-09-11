/** Test-owned Team task face: observable draft state plus recorded Host-intent actions. */
import { createSnapshotStore } from '@clocky/clocky-client-runtime/client'
import type {
  ITeamTasks, SnapshotStore, TeamTaskDraft, TeamTaskDraftOptions, TeamTaskListState, TeamTaskSelection,
  TeamTaskStartInput,
} from '@clocky/clocky-client-runtime/client'
import type { Stabilizer } from './fixtures.ts'

type TeamTaskStubs = Pick<ITeamTasks, 'refresh' | 'open' | 'start' | 'archive' | 'cancel' | 'resume' | 'postInput'>

/**
 * Team task test double. It mirrors local draft transitions and records
 * asynchronous operations; tests must explicitly stub durable Team results.
 */
export class TestTeamTasks implements ITeamTasks {
  /** The useTeamTasks standard feed. */
  readonly list: SnapshotStore<TeamTaskListState>
  /** Calls observed on the outward Team-task face, newest last. */
  readonly calls: { method: string; args: unknown[] }[] = []
  private readonly stubs: Partial<TeamTaskStubs> = {}
  private nextDraft = 0

  /** @param stabilize - the owning runtime's act wrapper. */
  constructor(private readonly stabilize: Stabilizer) {
    this.list = createSnapshotStore<TeamTaskListState>({
      items: [], current: undefined, selected: undefined, phase: 'ready', state: 'idle', error: null, draft: undefined,
    })
  }

  /**
   * Update the Team task product state through an immer draft.
   * @param mutate - state mutation supplied by the test.
   * @returns completion after the owning test runtime stabilizes React.
   */
  async update(mutate: (draft: TeamTaskListState) => void): Promise<void> {
    await this.stabilize(() => { this.list.update(mutate) })
  }

  /**
   * Replace one asynchronous operation while retaining its call record.
   * @param method - Team task operation to replace.
   * @param impl - replacement operation implementation.
   */
  stub<K extends keyof TeamTaskStubs>(method: K, impl: TeamTaskStubs[K]): void {
    this.stubs[method] = impl
  }

  /** Start a fresh local first-input draft. */
  startDraft(options?: TeamTaskDraftOptions): void {
    this.calls.push({ method: 'startDraft', args: options === undefined ? [] : [options] })
    const current = this.list.getSnapshot()
    const draft: TeamTaskDraft = {
      idempotencyKey: `test-team-task-${++this.nextDraft}` as TeamTaskDraft['idempotencyKey'],
      ...options?.agentPreset === undefined ? {} : { agentPreset: options.agentPreset },
      ...options?.cwd === undefined ? {} : { cwd: options.cwd },
      ...options?.selection === undefined ? {} : { selection: options.selection },
      phase: 'ready',
      error: undefined,
      message: undefined,
    }
    this.list.set({ ...current, current: undefined, draft })
  }

  /** Update local choices on the current first-input draft. */
  updateDraft(options: TeamTaskDraftOptions): void {
    this.calls.push({ method: 'updateDraft', args: [options] })
    const current = this.list.getSnapshot()
    if (current.draft === undefined) return
    this.list.set({ ...current, draft: { ...current.draft, ...options } })
  }

  /** Clear the local first-input draft. */
  abandonDraft(): void {
    this.calls.push({ method: 'abandonDraft', args: [] })
    this.list.set({ ...this.list.getSnapshot(), draft: undefined })
  }

  /** Record a Team-list refresh. */
  async refresh(): Promise<void> {
    this.calls.push({ method: 'refresh', args: [] })
    await this.stubs.refresh?.()
  }

  /** Resolve a Team only through an explicit test stub. */
  async open(teamId: Parameters<ITeamTasks['open']>[0], signal?: AbortSignal): Promise<TeamTaskSelection> {
    this.calls.push({ method: 'open', args: [teamId, signal] })
    const stub = this.stubs.open
    if (stub === undefined) throw new Error('test team tasks: open is not stubbed')
    return await stub(teamId, signal)
  }

  /** Start a Team only through an explicit test stub. */
  async start(input: TeamTaskStartInput, signal?: AbortSignal): Promise<TeamTaskSelection> {
    this.calls.push({ method: 'start', args: [input, signal] })
    const stub = this.stubs.start
    if (stub === undefined) throw new Error('test team tasks: start is not stubbed')
    return await stub(input, signal)
  }

  /** Archive a terminal Team only through an explicit test stub. */
  async archive(teamId: Parameters<ITeamTasks['archive']>[0], signal?: AbortSignal): Promise<Awaited<ReturnType<ITeamTasks['archive']>>> {
    this.calls.push({ method: 'archive', args: [teamId, signal] })
    const stub = this.stubs.archive
    if (stub === undefined) throw new Error('test team tasks: archive is not stubbed')
    return await stub(teamId, signal)
  }

  /** Cancel a Team only through an explicit test stub. */
  async cancel(teamId: Parameters<ITeamTasks['cancel']>[0], signal?: AbortSignal): Promise<Awaited<ReturnType<ITeamTasks['cancel']>>> {
    this.calls.push({ method: 'cancel', args: [teamId, signal] })
    const stub = this.stubs.cancel
    if (stub === undefined) throw new Error('test team tasks: cancel is not stubbed')
    return await stub(teamId, signal)
  }

  /** Resume a Team only through an explicit test stub. */
  async resume(teamId: Parameters<ITeamTasks['resume']>[0], signal?: AbortSignal): Promise<TeamTaskSelection> {
    this.calls.push({ method: 'resume', args: [teamId, signal] })
    const stub = this.stubs.resume
    if (stub === undefined) throw new Error('test team tasks: resume is not stubbed')
    return await stub(teamId, signal)
  }

  /** Record a Team-channel input without reaching a real Host in unit tests. */
  async postInput(
    teamId: Parameters<ITeamTasks['postInput']>[0],
    content: Parameters<ITeamTasks['postInput']>[1],
    delivery?: Parameters<ITeamTasks['postInput']>[2],
    signal?: Parameters<ITeamTasks['postInput']>[3],
  ): Promise<void> {
    this.calls.push({ method: 'postInput', args: [teamId, content, delivery, signal] })
    const stub = this.stubs.postInput
    if (stub === undefined) return
    await stub(teamId, content, delivery, signal)
  }

  /**
   * Return the currently selected Team for the coordinator Session.
   * @returns the selected Team task, or `undefined` when no Team is selected.
   */
  teamForCoordinatorSession(): TeamTaskSelection | undefined {
    return undefined
  }
}
