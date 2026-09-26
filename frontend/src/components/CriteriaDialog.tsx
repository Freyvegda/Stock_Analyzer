import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  CloseButton,
  Combobox,
  createListCollection,
  Dialog,
  Field,
  Flex,
  IconButton,
  Input,
  Portal,
  Stack,
  Switch,
  Text,
  Textarea,
} from '@chakra-ui/react'
import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { ApiError, api } from '@/api/client'
import type { Criterion, RatioSpec, UserCriteria } from '@/api/types'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import { toaster } from '@/components/ui/toaster'
import { StairTowerLoader } from '@/components/ui/StairTowerLoader'

interface DraftRow {
  key: string
  enabled: boolean
  value: string
}

type LoadPhase = 'idle' | 'loading' | 'ready' | 'error'

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.detail
  return err instanceof Error ? err.message : fallback
}

export function CriteriaDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (criteria: UserCriteria) => void
}) {
  const reduced = usePrefersReducedMotion()
  const [phase, setPhase] = useState<LoadPhase>('idle')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<RatioSpec[]>([])
  const [rows, setRows] = useState<DraftRow[]>([])
  const [thesis, setThesis] = useState('')
  const [query, setQuery] = useState('')
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setPhase('loading')
    setLoadError(null)
    try {
      const [ratioList, saved] = await Promise.all([
        api.get<RatioSpec[]>('/screen/ratios'),
        api.get<UserCriteria>('/screen/criteria'),
      ])
      setCatalog(ratioList)
      setRows(
        saved.criteria.map((criterion) => ({
          key: criterion.key,
          enabled: criterion.enabled,
          value: String(criterion.value),
        })),
      )
      setThesis(saved.thesis ?? '')
      setQuery('')
      setRowErrors({})
      setFormError(null)
      setPhase('ready')
    } catch (err) {
      setLoadError(errorMessage(err, 'Failed to load criteria'))
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const availableItems = useMemo(() => {
    const existing = new Set(rows.map((row) => row.key))
    const needle = query.trim().toLowerCase()
    return catalog
      .filter((ratio) => !existing.has(ratio.key))
      .filter((ratio) =>
        needle === ''
          ? true
          : ratio.label.toLowerCase().includes(needle) ||
            ratio.key.toLowerCase().includes(needle),
      )
      .map((ratio) => ({ label: ratio.label, value: ratio.key, category: ratio.category }))
  }, [catalog, rows, query])

  const collection = useMemo(
    () => createListCollection({ items: availableItems, groupBy: (item) => item.category }),
    [availableItems],
  )

  function specFor(key: string): RatioSpec | undefined {
    return catalog.find((ratio) => ratio.key === key)
  }

  function labelFor(key: string): string {
    return specFor(key)?.label ?? key
  }

  function toggleRow(key: string, enabled: boolean) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, enabled } : row)))
  }

  function setRowValue(key: string, value: string) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, value } : row)))
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((row) => row.key !== key))
  }

  function addRatio(key: string | undefined) {
    if (key === undefined || rows.some((row) => row.key === key)) return
    setRows((prev) => [...prev, { key, enabled: true, value: '' }])
  }

  async function save() {
    if (saving) return
    const errors: Record<number, string> = {}
    const parsed: Criterion[] = []
    rows.forEach((row, index) => {
      const value = row.value.trim() === '' ? Number.NaN : Number(row.value)
      if (!Number.isFinite(value)) {
        errors[index] = 'Enter a valid number'
        return
      }
      parsed.push({ key: row.key, enabled: row.enabled, value })
    })
    setRowErrors(errors)
    if (Object.keys(errors).length > 0) {
      setFormError('Fix the highlighted rows before saving')
      return
    }
    if (!parsed.some((criterion) => criterion.enabled)) {
      setFormError('Enable at least one criterion')
      return
    }
    if (thesis.length > 500) {
      setFormError('Thesis must be 500 characters or fewer')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const trimmed = thesis.trim()
      const saved = await api.put<UserCriteria>('/screen/criteria', {
        criteria: parsed,
        thesis: trimmed === '' ? null : trimmed,
      })
      toaster.create({
        title: 'Criteria saved',
        description: 'The next screen run uses these criteria.',
        type: 'success',
      })
      onSaved(saved)
      onOpenChange(false)
    } catch (err) {
      setFormError(errorMessage(err, 'Failed to save criteria'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details) => onOpenChange(details.open)}
      motionPreset="scale"
      size="lg"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Edit Criteria</Dialog.Title>
              <Dialog.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Dialog.CloseTrigger>
            </Dialog.Header>
            <Dialog.Body maxH="70vh" overflowY="auto">
              {phase === 'error' ? (
                <Stack gap={3} align="flex-start">
                  <Text role="alert" color="fg.error" fontSize="sm">
                    {loadError}
                  </Text>
                  <Button size="sm" variant="outline" onClick={() => void load()}>
                    Retry
                  </Button>
                </Stack>
              ) : phase === 'ready' ? (
                <Stack gap={5}>
                  <Stack gap={3}>
                    {rows.map((row, index) => {
                      const spec = specFor(row.key)
                      const label = labelFor(row.key)
                      return (
                        <motion.div
                          key={row.key}
                          initial={reduced ? false : { opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.22, delay: index * 0.03 }}
                        >
                          <Flex align="center" gap={3} opacity={row.enabled ? 1 : 0.6}>
                            <Switch.Root
                              checked={row.enabled}
                              onCheckedChange={(details) => toggleRow(row.key, details.checked)}
                            >
                              <Switch.HiddenInput aria-label={label} />
                              <Switch.Control>
                                <Switch.Thumb />
                              </Switch.Control>
                            </Switch.Root>
                            <Text fontSize="sm" flex="1">
                              {label}
                              {spec ? ` (${spec.unit})` : ''}
                            </Text>
                            {spec ? (
                              <Text fontSize="sm" color="fg.muted">
                                {spec.direction === 'min' ? '≥' : '≤'}
                              </Text>
                            ) : null}
                            <Input
                              size="sm"
                              maxW="32"
                              inputMode="decimal"
                              aria-label={`${label} value`}
                              value={row.value}
                              onChange={(e) => setRowValue(row.key, e.target.value)}
                            />
                            <IconButton
                              size="xs"
                              variant="ghost"
                              aria-label={`Remove ${label}`}
                              onClick={() => removeRow(row.key)}
                            >
                              <X size={14} strokeWidth={1.75} />
                            </IconButton>
                          </Flex>
                          {rowErrors[index] ? (
                            <Text fontSize="xs" color="fg.error" mt={1}>
                              {rowErrors[index]}
                            </Text>
                          ) : null}
                        </motion.div>
                      )
                    })}
                  </Stack>

                  <Combobox.Root
                    collection={collection}
                    onInputValueChange={(details) => setQuery(details.inputValue)}
                    onValueChange={(details) => addRatio(details.value[0])}
                  >
                    <Combobox.Label fontSize="sm">Add ratio</Combobox.Label>
                    <Combobox.Control>
                      <Combobox.Input placeholder="Add ratio" />
                      <Combobox.IndicatorGroup>
                        <Combobox.Trigger />
                      </Combobox.IndicatorGroup>
                    </Combobox.Control>
                    <Combobox.Positioner>
                      <Combobox.Content>
                        <Combobox.Empty>No ratios found</Combobox.Empty>
                        {collection.group().map(([group, items]) => (
                          <Combobox.ItemGroup key={group}>
                            <Combobox.ItemGroupLabel>{group}</Combobox.ItemGroupLabel>
                            {items.map((item) => (
                              <Combobox.Item key={item.value} item={item}>
                                {item.label}
                                <Combobox.ItemIndicator />
                              </Combobox.Item>
                            ))}
                          </Combobox.ItemGroup>
                        ))}
                      </Combobox.Content>
                    </Combobox.Positioner>
                  </Combobox.Root>

                  <Field.Root>
                    <Field.Label>Thesis</Field.Label>
                    <Textarea
                      rows={3}
                      maxLength={500}
                      value={thesis}
                      onChange={(e) => setThesis(e.target.value)}
                    />
                    <Field.HelperText>{thesis.length}/500</Field.HelperText>
                  </Field.Root>

                  {formError !== null ? (
                    <Text role="alert" color="fg.error" fontSize="sm">
                      {formError}
                    </Text>
                  ) : null}
                </Stack>
              ) : (
                <Flex justify="center" py={4}>
                  <StairTowerLoader size={80} label="Loading criteria…" />
                </Flex>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                colorPalette="emerald"
                loading={saving}
                disabled={saving}
                spinner={<StairTowerLoader size={20} label="Saving…" />}
                onClick={() => void save()}
              >
                Save
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
