/**
 * Chrome-style glass tab strip for saved screens.
 *
 * One real `<button role="tab">` per screening set (native Enter/Space), with the
 * pencil/× controls hoisted OUT of the tab into a hover/focus cluster (nested
 * interactive elements inside role=tab are presentational and keyboard-hostile).
 * Naming happens inside the strip: `+` spawns a focused draft tab the user types
 * into (Enter creates, Esc/click-away cancels); the pencil flips the active tab
 * into rename-in-place (Enter saves, Esc reverts). Delete keeps an under-strip
 * confirm group. Roving tabindex + Arrow/Home/End; dirty drafts get an sr-only
 * "(unsaved changes)" description. No dialogs.
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Box, Button, Flex, IconButton, Input, Text } from '@chakra-ui/react'
import { Pencil, Plus, X } from 'lucide-react'
import type { ScreeningSet } from '@/api/types'

export interface ScreenTabsProps {
  sets: ScreeningSet[]
  active: ScreeningSet | null
  dirty?: boolean
  busy?: boolean
  onSelect: (set: ScreeningSet) => void
  onCreate: (name: string) => Promise<void>
  onRename: (set: ScreeningSet, name: string) => Promise<void>
  onDelete: (set: ScreeningSet) => Promise<void>
}

export const TABPANEL_ID = 'screen-tabpanel'

export function tabId(setId: number): string {
  return `screen-tab-${setId}`
}

export function ScreenTabs({
  sets,
  active,
  dirty = false,
  busy = false,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: ScreenTabsProps) {
  const [drafting, setDrafting] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [renaming, setRenaming] = useState<ScreeningSet | null>(null)
  const [renameName, setRenameName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<ScreeningSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const tabRefs = useRef(new Map<number, HTMLButtonElement>())
  const plusRef = useRef<HTMLButtonElement>(null)

  const disabled = busy || working

  function focusActiveTab() {
    window.requestAnimationFrame(() => {
      const target =
        (active !== null ? tabRefs.current.get(active.id) : undefined) ??
        (sets[0] !== undefined ? tabRefs.current.get(sets[0].id) : undefined)
      if (target !== undefined) {
        target.focus()
      } else {
        plusRef.current?.focus()
      }
    })
  }

  useEffect(() => {
    if (renaming !== null && !sets.some((set) => set.id === renaming.id)) {
      setRenaming(null) // the renamed screen disappeared (deleted elsewhere)
    }
  }, [sets, renaming])

  async function run(action: () => Promise<void>, after?: () => void) {
    setError(null)
    setWorking(true)
    try {
      await action()
      setDrafting(false)
      setDraftName('')
      setRenaming(null)
      setConfirmDelete(null)
      after?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setWorking(false)
    }
  }

  function cancelDraft() {
    setDrafting(false)
    setDraftName('')
    setError(null)
    plusRef.current?.focus()
  }

  function cancelRename() {
    setRenaming(null)
    setRenameName('')
    setError(null)
    focusActiveTab()
  }

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.target !== event.currentTarget) return // arrows from the controls never move tabs
    if (
      event.key !== 'ArrowRight' &&
      event.key !== 'ArrowLeft' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return
    }
    event.preventDefault()
    let next = index
    if (event.key === 'ArrowRight') next = Math.min(index + 1, sets.length - 1)
    if (event.key === 'ArrowLeft') next = Math.max(index - 1, 0)
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = sets.length - 1
    tabRefs.current.get(sets[next].id)?.focus()
  }

  function onDraftKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (draftName.trim() === '') return
      void run(() => onCreate(draftName.trim()), focusActiveTab)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelDraft()
    }
  }

  function onRenameKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (renaming === null || renameName.trim() === '') return
      void run(() => onRename(renaming, renameName.trim()), focusActiveTab)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelRename()
    }
  }

  return (
    <Box>
      <Flex align="flex-end" gap={1} pr={1}>
        <Box role="tablist" aria-label="Screening screens" className="tab-strip">
          {sets.map((set, index) => {
            const isActive = set.id === active?.id
            const isRenaming = renaming?.id === set.id
            const tabIndex = isActive || (active === null && index === 0) ? 0 : -1
            return (
              <Box key={set.id} className="tab-wrap">
                {isRenaming ? (
                  <div className="glass-tab" data-active={isActive ? 'true' : 'false'}>
                    <Input
                      autoFocus
                      variant="flushed"
                      aria-label={`Rename ${set.name}`}
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      onKeyDown={onRenameKeyDown}
                      onBlur={cancelRename}
                      className="h-5 w-32 min-w-0 border-0 bg-transparent p-0 text-sm"
                    />
                  </div>
                ) : (
                  <button
                    ref={(node: HTMLButtonElement | null) => {
                      if (node === null) {
                        tabRefs.current.delete(set.id)
                      } else {
                        tabRefs.current.set(set.id, node)
                      }
                    }}
                    type="button"
                    role="tab"
                    id={tabId(set.id)}
                    aria-selected={isActive}
                    aria-controls={TABPANEL_ID}
                    aria-label={set.name}
                    aria-describedby={isActive && dirty ? `screen-dirty-${set.id}` : undefined}
                    tabIndex={tabIndex}
                    data-active={isActive ? 'true' : 'false'}
                    data-dirty={isActive && dirty ? 'true' : undefined}
                    className="glass-tab"
                    onClick={() => {
                      if (!disabled) onSelect(set)
                    }}
                    onKeyDown={(event) => onTabKeyDown(event, index)}
                  >
                    <span className="min-w-0 truncate">{set.name}</span>
                    {isActive && dirty ? (
                      <>
                        <span
                          aria-hidden="true"
                          data-testid="tab-dirty-dot"
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                        />
                        <span id={`screen-dirty-${set.id}`} className="sr-only">
                          unsaved changes
                        </span>
                      </>
                    ) : null}
                  </button>
                )}
                {isActive && !isRenaming ? (
                  <span className="tab-controls">
                    <IconButton
                      size="2xs"
                      variant="ghost"
                      aria-label={`Rename ${set.name}`}
                      disabled={disabled}
                      onClick={() => {
                        setRenaming(set)
                        setRenameName(set.name)
                        setDrafting(false)
                        setConfirmDelete(null)
                        setError(null)
                      }}
                    >
                      <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      size="2xs"
                      variant="ghost"
                      aria-label={`Close ${set.name}`}
                      disabled={disabled}
                      onClick={() => {
                        setConfirmDelete(set)
                        setDrafting(false)
                        setError(null)
                      }}
                    >
                      <X size={14} strokeWidth={1.75} aria-hidden="true" />
                    </IconButton>
                  </span>
                ) : null}
                {!isActive ? (
                  <span className="tab-controls">
                    <IconButton
                      size="2xs"
                      variant="ghost"
                      aria-label={`Close ${set.name}`}
                      disabled={disabled}
                      onClick={() => {
                        setConfirmDelete(set)
                        setDrafting(false)
                        setError(null)
                      }}
                    >
                      <X size={14} strokeWidth={1.75} aria-hidden="true" />
                    </IconButton>
                  </span>
                ) : null}
              </Box>
            )
          })}

          {drafting ? (
            <Box className="tab-wrap">
              <div className="glass-tab glass-tab-draft" data-active="false">
                <Input
                  autoFocus
                  variant="flushed"
                  aria-label="New screen name"
                  placeholder="Screen name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={onDraftKeyDown}
                  onBlur={cancelDraft}
                  className="h-5 w-32 min-w-0 border-0 bg-transparent p-0 text-sm"
                />
              </div>
            </Box>
          ) : null}
        </Box>
        <IconButton
          ref={plusRef}
          size="sm"
          variant="ghost"
          aria-label="New screen"
          title="New screen"
          disabled={disabled}
          onClick={() => {
            setDrafting(true)
            setDraftName('')
            setRenaming(null)
            setConfirmDelete(null)
            setError(null)
          }}
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      </Flex>

      {confirmDelete !== null ? (
        <Flex
          role="group"
          aria-label={`Confirm delete ${confirmDelete.name}`}
          gap={2}
          mt={2}
          align="center"
          wrap="wrap"
        >
          <Text fontSize="sm">Delete screen "{confirmDelete.name}"?</Text>
          <Button
            size="sm"
            colorPalette="loss"
            loading={working}
            disabled={disabled}
            onClick={() => void run(() => onDelete(confirmDelete), focusActiveTab)}
          >
            Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={working}
            onClick={() => {
              setConfirmDelete(null)
              focusActiveTab()
            }}
          >
            Cancel
          </Button>
        </Flex>
      ) : null}

      {error !== null ? (
        <Text role="alert" color="fg.error" fontSize="sm" mt={2}>
          {error}
        </Text>
      ) : null}
    </Box>
  )
}

export default ScreenTabs
