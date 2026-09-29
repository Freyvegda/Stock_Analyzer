/**
 * Chrome-style glass tab strip for saved screens (owner request, 2026-09-29).
 *
 * One tab per screening set: click to activate, `×` opens an inline confirm row
 * under the strip, the pencil renames the active tab, `+` grows into a name
 * field for a new screen. The active tab carries a sakura dot while the editor
 * draft is dirty and merges into the panel below (`glass-tab` + connected panel).
 * Arrow keys move tab focus (roving tabindex); Enter/Space activate (native
 * button semantics on the tab body). No dialogs.
 */

import { useRef, useState } from 'react'
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

type Mode = 'idle' | 'new' | 'rename'

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
  const [mode, setMode] = useState<Mode>('idle')
  const [target, setTarget] = useState<ScreeningSet | null>(null)
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<ScreeningSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const tabRefs = useRef(new Map<number, HTMLElement>())

  const disabled = busy || working

  function reset() {
    setMode('idle')
    setTarget(null)
    setName('')
    setConfirmDelete(null)
  }

  async function run(action: () => Promise<void>) {
    setError(null)
    setWorking(true)
    try {
      await action()
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setWorking(false)
    }
  }

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLElement>, index: number) {
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

  return (
    <Box>
      <Flex align="flex-end" gap={1} pr={1}>
        <Box role="tablist" aria-label="Screening screens" className="tab-strip">
          {sets.map((set, index) => {
            const isActive = set.id === active?.id
            return (
              <Box
                key={set.id}
                ref={(node: HTMLDivElement | null) => {
                  if (node === null) {
                    tabRefs.current.delete(set.id)
                  } else {
                    tabRefs.current.set(set.id, node)
                  }
                }}
                role="tab"
                aria-selected={isActive}
                aria-label={set.name}
                tabIndex={isActive ? 0 : -1}
                data-active={isActive ? 'true' : 'false'}
                data-dirty={isActive && dirty ? 'true' : undefined}
                className="glass-tab"
                onClick={() => onSelect(set)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                <span className="min-w-0 truncate">{set.name}</span>
                {isActive && dirty ? (
                  <span
                    aria-hidden="true"
                    data-testid="tab-dirty-dot"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                  />
                ) : null}
                {isActive ? (
                  <IconButton
                    size="2xs"
                    variant="ghost"
                    aria-label={`Rename ${set.name}`}
                    disabled={disabled}
                    onClick={(event) => {
                      event.stopPropagation()
                      setMode('rename')
                      setTarget(set)
                      setName(set.name)
                      setConfirmDelete(null)
                      setError(null)
                    }}
                  >
                    <Pencil size={12} strokeWidth={1.75} aria-hidden="true" />
                  </IconButton>
                ) : null}
                <IconButton
                  size="2xs"
                  variant="ghost"
                  aria-label={`Close ${set.name}`}
                  disabled={disabled}
                  onClick={(event) => {
                    event.stopPropagation()
                    setConfirmDelete(set)
                    setMode('idle')
                    setError(null)
                  }}
                >
                  <X size={12} strokeWidth={1.75} aria-hidden="true" />
                </IconButton>
              </Box>
            )
          })}
        </Box>
        <IconButton
          size="sm"
          variant="ghost"
          aria-label="New screen"
          title="New screen"
          disabled={disabled}
          onClick={() => {
            setMode('new')
            setTarget(null)
            setName('')
            setConfirmDelete(null)
            setError(null)
          }}
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      </Flex>

      {mode === 'new' ? (
        <Flex gap={2} mt={2} align="center" wrap="wrap">
          <Input
            size="sm"
            maxW="48"
            aria-label="Screen name"
            placeholder="Screen name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            size="sm"
            colorPalette="sakura"
            loading={working}
            disabled={disabled || name.trim() === ''}
            onClick={() => void run(() => onCreate(name.trim()))}
          >
            Create
          </Button>
          <Button size="sm" variant="ghost" disabled={working} onClick={reset}>
            Cancel
          </Button>
        </Flex>
      ) : null}

      {mode === 'rename' && target !== null ? (
        <Flex gap={2} mt={2} align="center" wrap="wrap">
          <Input
            size="sm"
            maxW="48"
            aria-label={`Rename ${target.name}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button
            size="sm"
            colorPalette="sakura"
            loading={working}
            disabled={disabled || name.trim() === ''}
            onClick={() => void run(() => onRename(target, name.trim()))}
          >
            Save name
          </Button>
          <Button size="sm" variant="ghost" disabled={working} onClick={reset}>
            Cancel
          </Button>
        </Flex>
      ) : null}

      {confirmDelete !== null ? (
        <Flex gap={2} mt={2} align="center" wrap="wrap">
          <Text fontSize="sm">Delete screen "{confirmDelete.name}"?</Text>
          <Button
            size="sm"
            colorPalette="loss"
            loading={working}
            disabled={disabled}
            onClick={() => void run(() => onDelete(confirmDelete))}
          >
            Delete
          </Button>
          <Button size="sm" variant="ghost" disabled={working} onClick={() => setConfirmDelete(null)}>
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
