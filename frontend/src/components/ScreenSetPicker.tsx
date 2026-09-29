/**
 * Saved-screen picker — lists the caller's screening sets, marks the active one
 * and offers inline New / Rename / Delete. No dialogs: every action opens a
 * field or a two-step confirm inside the row.
 */

import { useState } from 'react'
import { Badge, Box, Button, Flex, IconButton, Input, Text } from '@chakra-ui/react'
import { Pencil, Trash2 } from 'lucide-react'
import type { ScreeningSet } from '@/api/types'

export interface ScreenSetPickerProps {
  sets: ScreeningSet[]
  active: ScreeningSet | null
  busy?: boolean
  onSelect: (set: ScreeningSet) => void
  onCreate: (name: string) => Promise<void>
  onRename: (set: ScreeningSet, name: string) => Promise<void>
  onDelete: (set: ScreeningSet) => Promise<void>
}

type Mode = 'idle' | 'new' | 'rename'

export function ScreenSetPicker({
  sets,
  active,
  busy = false,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: ScreenSetPickerProps) {
  const [mode, setMode] = useState<Mode>('idle')
  const [target, setTarget] = useState<ScreeningSet | null>(null)
  const [name, setName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

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

  function startRename(set: ScreeningSet) {
    setMode('rename')
    setTarget(set)
    setName(set.name)
    setConfirmDelete(null)
    setError(null)
  }

  return (
    <Box borderWidth="1px" borderColor="border" rounded="lg" p={4} bg="bg.panel">
      <Flex justify="space-between" align="center" mb={3} gap={3} wrap="wrap">
        <Text fontWeight="semibold" fontSize="sm">
          Screening Screens
        </Text>
        <Button
          size="sm"
          variant="outline"
          colorPalette="sakura"
          disabled={disabled}
          onClick={() => {
            setMode('new')
            setTarget(null)
            setName('')
            setError(null)
          }}
        >
          New screen
        </Button>
      </Flex>

      {mode === 'new' ? (
        <Flex gap={2} mb={3} align="center" wrap="wrap">
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

      <Flex direction="column" gap={1}>
        {sets.map((set) =>
          mode === 'rename' && target?.id === set.id ? (
            <Flex key={set.id} gap={2} align="center" wrap="wrap">
              <Input
                size="sm"
                maxW="48"
                aria-label={`Rename ${set.name}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                size="sm"
                colorPalette="sakura"
                loading={working}
                disabled={disabled || name.trim() === ''}
                onClick={() => void run(() => onRename(set, name.trim()))}
              >
                Save name
              </Button>
              <Button size="sm" variant="ghost" disabled={working} onClick={reset}>
                Cancel
              </Button>
            </Flex>
          ) : (
            <Flex key={set.id} gap={2} align="center" wrap="wrap">
              <Button
                size="sm"
                variant={set.is_active ? 'subtle' : 'ghost'}
                colorPalette={set.is_active ? 'sakura' : undefined}
                aria-pressed={set.is_active}
                disabled={disabled}
                onClick={() => onSelect(set)}
              >
                {set.name}
              </Button>
              {set.id === active?.id ? (
                <Badge variant="subtle" colorPalette="sakura">
                  Active
                </Badge>
              ) : null}
              <Flex ml="auto" gap={1}>
                <IconButton
                  size="xs"
                  variant="ghost"
                  aria-label={`Rename ${set.name}`}
                  disabled={disabled}
                  onClick={() => startRename(set)}
                >
                  <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                </IconButton>
                {confirmDelete === set.id ? (
                  <>
                    <Button
                      size="xs"
                      colorPalette="loss"
                      loading={working}
                      disabled={disabled}
                      onClick={() => void run(() => onDelete(set))}
                    >
                      Confirm
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={working}
                      onClick={() => setConfirmDelete(null)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <IconButton
                    size="xs"
                    variant="ghost"
                    aria-label={`Delete ${set.name}`}
                    disabled={disabled}
                    onClick={() => {
                      setConfirmDelete(set.id)
                      setError(null)
                    }}
                  >
                    <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
                  </IconButton>
                )}
              </Flex>
            </Flex>
          ),
        )}
      </Flex>

      {error !== null ? (
        <Text role="alert" color="fg.error" fontSize="sm" mt={2}>
          {error}
        </Text>
      ) : null}
    </Box>
  )
}

export default ScreenSetPicker
