/**
 * Inline criteria editor — the dialog-free replacement for CriteriaDialog.
 *
 * Outer accordion (`open` controlled by the page's Edit Criteria button) holds
 * one sub-accordion per catalog category; every category starts expanded so the
 * complete table shows at once. Rows toggle/edit thresholds per ratio, each
 * category has its own "add" combobox, and the per-screen thesis sits at the
 * bottom. Save validates in place; the page drives Run through the imperative
 * `save()` handle so a dirty draft is persisted before a run.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Accordion,
  Button,
  Combobox,
  createListCollection,
  Field,
  Flex,
  IconButton,
  Input,
  Stack,
  Switch,
  Text,
  Textarea,
} from '@chakra-ui/react'
import { X } from 'lucide-react'
import { ApiError } from '@/api/client'
import type { Criterion, RatioSpec, ScreeningSet } from '@/api/types'

const OTHER_CATEGORY = 'Other'

interface DraftRow {
  key: string
  enabled: boolean
  value: string
}

export interface CriteriaEditorHandle {
  /** Persist the current draft when dirty; resolves false when invalid. */
  save: () => Promise<boolean>
}

export interface CriteriaEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  set: ScreeningSet | null
  ratios: RatioSpec[]
  onSave: (criteria: Criterion[], thesis: string | null) => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.detail
  return err instanceof Error ? err.message : fallback
}

function draftFromSet(set: ScreeningSet | null): DraftRow[] {
  return (set?.criteria ?? []).map((criterion) => ({
    key: criterion.key,
    enabled: criterion.enabled,
    value: String(criterion.value),
  }))
}

function snapshot(rows: DraftRow[], thesis: string): string {
  return JSON.stringify({
    rows: rows.map((row) => ({ key: row.key, enabled: row.enabled, value: row.value.trim() })),
    thesis: thesis.trim(),
  })
}

function AddCriterion({
  category,
  options,
  onAdd,
}: {
  category: string
  options: RatioSpec[]
  onAdd: (key: string) => void
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const visible = options.filter(
    (ratio) =>
      needle === '' ||
      ratio.label.toLowerCase().includes(needle) ||
      ratio.key.toLowerCase().includes(needle),
  )
  const collection = useMemo(
    () => createListCollection({ items: visible.map((ratio) => ({ label: ratio.label, value: ratio.key })) }),
    [visible],
  )
  return (
    <Combobox.Root
      collection={collection}
      onInputValueChange={(details) => setQuery(details.inputValue)}
      onValueChange={(details) => {
        const key = details.value[0]
        if (key !== undefined) onAdd(key)
        setQuery('')
      }}
    >
      <Combobox.Control>
        <Combobox.Input
          placeholder={`Add to ${category}`}
          aria-label={`Add ${category} criterion`}
        />
        <Combobox.IndicatorGroup>
          <Combobox.Trigger />
        </Combobox.IndicatorGroup>
      </Combobox.Control>
      <Combobox.Positioner>
        <Combobox.Content>
          <Combobox.Empty>No ratios left</Combobox.Empty>
          {visible.map((ratio) => {
            const item = { label: ratio.label, value: ratio.key }
            return (
              <Combobox.Item key={ratio.key} item={item}>
                {ratio.label}
                <Combobox.ItemIndicator />
              </Combobox.Item>
            )
          })}
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  )
}

export const CriteriaEditor = forwardRef<CriteriaEditorHandle, CriteriaEditorProps>(
  function CriteriaEditor({ open, onOpenChange, set, ratios, onSave, onDirtyChange }, ref) {
    const [rows, setRows] = useState<DraftRow[]>([])
    const [thesis, setThesis] = useState('')
    const [rowErrors, setRowErrors] = useState<Record<number, string>>({})
    const [formError, setFormError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    // Reset the draft whenever the source set changes (activation, save echo,
    // creation). Object identity is the signal; the page replaces the object
    // on every mutation.
    useEffect(() => {
      setRows(draftFromSet(set))
      setThesis(set?.thesis ?? '')
      setRowErrors({})
      setFormError(null)
    }, [set])

    const catalog = useMemo(() => new Map(ratios.map((ratio) => [ratio.key, ratio])), [ratios])
    const savedSnapshot = useMemo(
      () => snapshot(draftFromSet(set), set?.thesis ?? ''),
      [set],
    )
    const dirty = useMemo(
      () => snapshot(rows, thesis) !== savedSnapshot,
      [rows, thesis, savedSnapshot],
    )

    useEffect(() => {
      onDirtyChange?.(dirty)
    }, [dirty, onDirtyChange])

    const categoryOf = useCallback(
      (key: string) => catalog.get(key)?.category ?? OTHER_CATEGORY,
      [catalog],
    )

    const categories = useMemo(() => {
      const order: string[] = []
      for (const ratio of ratios) {
        if (!order.includes(ratio.category)) order.push(ratio.category)
      }
      if (rows.some((row) => !catalog.has(row.key))) order.push(OTHER_CATEGORY)
      return order
    }, [ratios, rows, catalog])

    // Every category starts expanded; a category that appears later (unknown
    // stored keys → "Other") auto-expands too. Manual collapses stick: known
    // category names are only added once.
    const knownCategories = useRef<Set<string>>(new Set())
    const [expanded, setExpanded] = useState<string[]>([])
    useEffect(() => {
      const fresh = categories.filter((category) => !knownCategories.current.has(category))
      if (fresh.length === 0) return
      for (const category of fresh) knownCategories.current.add(category)
      setExpanded((prev) => [...prev, ...fresh])
    }, [categories])

    function toggleRow(key: string, enabled: boolean) {
      setRows((prev) => prev.map((row) => (row.key === key ? { ...row, enabled } : row)))
    }

    function setRowValue(key: string, value: string) {
      setRows((prev) => prev.map((row) => (row.key === key ? { ...row, value } : row)))
    }

    function removeRow(key: string) {
      setRows((prev) => prev.filter((row) => row.key !== key))
    }

    function addRatio(key: string) {
      if (rows.some((row) => row.key === key)) return
      setRows((prev) => [...prev, { key, enabled: true, value: '' }])
    }

    const save = useCallback(async (): Promise<boolean> => {
      if (set === null || !dirty) return true
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
        return false
      }
      if (!parsed.some((criterion) => criterion.enabled)) {
        setFormError('Enable at least one criterion')
        return false
      }
      if (thesis.length > 500) {
        setFormError('Thesis must be 500 characters or fewer')
        return false
      }
      setSaving(true)
      setFormError(null)
      try {
        const trimmed = thesis.trim()
        await onSave(parsed, trimmed === '' ? null : trimmed)
        return true
      } catch (err) {
        setFormError(errorMessage(err, 'Failed to save criteria'))
        return false
      } finally {
        setSaving(false)
      }
    }, [set, dirty, rows, thesis, onSave])

    useImperativeHandle(ref, () => ({ save }), [save])

    return (
      <Accordion.Root
        multiple
        collapsible
        value={open ? ['editor'] : []}
        onValueChange={(details) => onOpenChange(details.value.includes('editor'))}
      >
        <Accordion.Item value="editor" borderWidth="1px" borderColor="border" rounded="lg" bg="bg.panel">
          <Accordion.ItemTrigger px={4} py={3}>
            <Text flex="1" fontSize="sm" fontWeight="semibold">
              Criteria{set !== null ? ` · ${set.name}` : ''}
            </Text>
            <Accordion.ItemIndicator />
          </Accordion.ItemTrigger>
          <Accordion.ItemContent px={4} pb={4}>
            <Accordion.ItemBody>
              {set === null ? (
                <Text fontSize="sm" color="fg.muted">
                  Loading criteria…
                </Text>
              ) : (
                <Stack gap={4}>
                  <Accordion.Root
                    multiple
                    value={expanded}
                    onValueChange={(details) => setExpanded(details.value)}
                  >
                    {categories.map((category) => {
                      const entries = rows
                        .map((row, index) => ({ row, index }))
                        .filter(({ row }) => categoryOf(row.key) === category)
                      const enabledCount = entries.filter(({ row }) => row.enabled).length
                      const options = ratios.filter(
                        (ratio) =>
                          ratio.category === category &&
                          !rows.some((row) => row.key === ratio.key),
                      )
                      return (
                        <Accordion.Item key={category} value={category}>
                          <Accordion.ItemTrigger py={2}>
                            <Text flex="1" fontSize="sm">
                              {category}
                            </Text>
                            <Text fontSize="xs" color="fg.muted" mr={2}>
                              {enabledCount}/{entries.length}
                            </Text>
                            <Accordion.ItemIndicator />
                          </Accordion.ItemTrigger>
                          <Accordion.ItemContent pb={2}>
                            <Accordion.ItemBody>
                              <Stack gap={2}>
                                {entries.map(({ row, index }) => {
                                  const spec = catalog.get(row.key)
                                  const label = spec?.label ?? row.key
                                  return (
                                    <div key={row.key}>
                                      <Flex align="center" gap={3} opacity={row.enabled ? 1 : 0.6}>
                                        <Switch.Root
                                          checked={row.enabled}
                                          onCheckedChange={(details) =>
                                            toggleRow(row.key, details.checked)
                                          }
                                        >
                                          <Switch.HiddenInput aria-label={label} />
                                          <Switch.Control>
                                            <Switch.Thumb />
                                          </Switch.Control>
                                        </Switch.Root>
                                        <Text fontSize="sm" flex="1">
                                          {label}
                                          {spec !== undefined ? ` (${spec.unit})` : ''}
                                        </Text>
                                        {spec !== undefined ? (
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
                                          <X size={14} strokeWidth={1.75} aria-hidden="true" />
                                        </IconButton>
                                      </Flex>
                                      {rowErrors[index] !== undefined ? (
                                        <Text fontSize="xs" color="fg.error" mt={1}>
                                          {rowErrors[index]}
                                        </Text>
                                      ) : null}
                                    </div>
                                  )
                                })}
                                {options.length > 0 || category === OTHER_CATEGORY ? (
                                  <AddCriterion
                                    category={category}
                                    options={options}
                                    onAdd={addRatio}
                                  />
                                ) : null}
                              </Stack>
                            </Accordion.ItemBody>
                          </Accordion.ItemContent>
                        </Accordion.Item>
                      )
                    })}
                  </Accordion.Root>

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

                  <Button
                    alignSelf="flex-start"
                    colorPalette="sakura"
                    loading={saving}
                    loadingText="Saving…"
                    onClick={() => void save()}
                  >
                    Save
                  </Button>
                </Stack>
              )}
            </Accordion.ItemBody>
          </Accordion.ItemContent>
        </Accordion.Item>
      </Accordion.Root>
    )
  },
)

export default CriteriaEditor
