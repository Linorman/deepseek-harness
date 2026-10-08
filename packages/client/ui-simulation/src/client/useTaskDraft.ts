import { useEffect, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

interface TaskDraftState<T> {
  latest: MutableRefObject<T>
  active: MutableRefObject<boolean>
  error: string | undefined
  setError: Dispatch<SetStateAction<string | undefined>>
  change: (next: T) => void
}

/**
 * Keep task dialog edits and late command settlement bound to their mounted draft owner.
 * @param draft - The latest retained draft.
 * @param save - The bounded draft admission operation.
 * @param capacityError - Localized text when draft admission is refused.
 * @returns The current draft, mounted lifetime, error state and guarded edit operation.
 */
export function useTaskDraft<T>(draft: T, save: (draft: T) => void, capacityError: () => string): TaskDraftState<T> {
  const latest = useRef(draft), active = useRef(true)
  latest.current = draft
  const [error, setError] = useState<string>()
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const change = (next: T) => {
    try { save(next); latest.current = next; setError(undefined) }
    catch { setError(capacityError()) }
  }
  return { latest, active, error, setError, change }
}
