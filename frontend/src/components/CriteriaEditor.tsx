/**
 * Inline criteria editor — the dialog-free replacement for CriteriaDialog.
 *
 * Outer accordion (`open` controlled by the page's Edit Criteria button) holds
 * the rotary category dial, the bookmarked-criteria ribbon rail and the draft's
 * own controls. The dial shows one category at a time: its wedge ring turns the
 * chosen category under the bottom notch and that category's criterion cards
 * (plus its "add" combobox) render beside it. The enabled-ratio summary lives in
 * the CriteriaPanel above, which stays the cross-category view. Rows toggle/edit
 * thresholds per ratio and the per-screen thesis sits at the bottom. Save
 * validates in place; the page drives Run through the imperative `save()` handle
 * so a dirty draft is persisted before a run.
 */

import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react'
import {
  Accordion,
  Box,
  Button,
  Combobox,
  createListCollection,
  Field,
  Flex,
  Stack,
  Text,
  Textarea,
} from '@chakra-ui/react'
import { ApiError } from '@/api/client'
import { CategoryDial } from '@/components/CategoryDial'
import { CriterionCard } from '@/components/CriterionCard'
import { usePrefersReducedMotion } from '@/lib/usePrefersReducedMotion'
import type { Criterion, RatioSpec, ScreeningSet } from '@/api/types'

const RibbonRail = lazy(() => import('@/components/three/RibbonRail'))

const OTHER_CATEGORY = 'Other'

interface DraftRow {
  key: string
  enabled: boolean
  value: string
  bookmarked: boolean
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
  /** The screen is mid-run: every control locks and save() resolves false. */
  disabled?: boolean
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
    bookmarked: criterion.bookmarked ?? false,
  }))
}

function snapshot(rows: DraftRow[], thesis: string): string {
  return JSON.stringify({
    rows: rows.map((row) => ({
      key: row.key,
      enabled: row.enabled,
      value: row.value.trim(),
      bookmarked: row.bookmarked,
    })),
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
        <Combobox.Content className="combobox-pop">
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
  function CriteriaEditor(
    { open, onOpenChange, set, ratios, onSave, onDirtyChange, disabled = false },
    ref,
  ) {
    const [rows, setRows] = useState<DraftRow[]>([])
    const [thesis, setThesis] = useState('')
    const [rowErrors, setRowErrors] = useState<Record<number, string>>({})
    const [formError, setFormError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [bookmarkedOnly, setBookmarkedOnly] = useState(false)
    const [pick, setPick] = useState<string | null>(null)
    const reduced = usePrefersReducedMotion()

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

    // A category with no draft rows still gets a wedge (that is where its "add"
    // combobox lives); the hub tally reads 0/N.
    const stats = useMemo(() => {
      const counts = new Map<string, { enabled: number; total: number }>(
        categories.map((category) => [category, { enabled: 0, total: 0 }]),
      )
      for (const row of rows) {
        const category = categoryOf(row.key)
        const count = counts.get(category) ?? { enabled: 0, total: 0 }
        count.total += 1
        if (row.enabled) count.enabled += 1
        counts.set(category, count)
      }
      return counts
    }, [categories, rows, categoryOf])

    // The dial only carries selectable categories: with the bookmark filter on,
    // categories that hold no bookmark drop out of the ring.
    const dialCategories = useMemo(
      () =>
        bookmarkedOnly
          ? categories.filter((category) =>
              rows.some((row) => row.bookmarked && categoryOf(row.key) === category),
            )
          : categories,
      [bookmarkedOnly, categories, rows, categoryOf],
    )

    // Derived, not stored: the pick survives renders, but a category that left
    // the ring (or a draft that arrived without rows) falls back to the first
    // category holding something.
    const fallback = useMemo(() => {
      const withRows = dialCategories.find((category) => (stats.get(category)?.total ?? 0) > 0)
      return withRows ?? dialCategories[0] ?? null
    }, [dialCategories, stats])
    const selected =
      pick !== null && dialCategories.includes(pick) ? pick : fallback

    const segments = useMemo(
      () =>
        dialCategories.map((category) => ({
          category,
          enabled: stats.get(category)?.enabled ?? 0,
          total: stats.get(category)?.total ?? 0,
        })),
      [dialCategories, stats],
    )

    function toggleRow(key: string, enabled: boolean) {
      setRows((prev) => prev.map((row) => (row.key === key ? { ...row, enabled } : row)))
    }

    function toggleBookmark(key: string) {
      setRows((prev) =>
        prev.map((row) => (row.key === key ? { ...row, bookmarked: !row.bookmarked } : row)),
      )
    }

    function setRowValue(key: string, value: string) {
      setRows((prev) => prev.map((row) => (row.key === key ? { ...row, value } : row)))
    }

    function removeRow(key: string) {
      setRows((prev) => prev.filter((row) => row.key !== key))
    }

    function addRatio(key: string) {
      if (rows.some((row) => row.key === key)) return
      setRows((prev) => [...prev, { key, enabled: true, value: '', bookmarked: false }])
    }

    const bookmarkedItems = useMemo(
      () =>
        rows
          .filter((row) => row.bookmarked)
          .map((row) => ({ key: row.key, label: catalog.get(row.key)?.label ?? row.key })),
      [rows, catalog],
    )

    function handleRibbonSelect(key: string) {
      setBookmarkedOnly(false)
      setPick(categoryOf(key))
      window.requestAnimationFrame(() => {
        document.querySelector(`[data-criterion="${key}"]`)?.scrollIntoView?.({ block: 'center' })
      })
    }

    const save = useCallback(async (): Promise<boolean> => {
      if (disabled) return false
      if (set === null || !dirty) return true
      const errors: Record<number, string> = {}
      const parsed: Criterion[] = []
      rows.forEach((row, index) => {
        const value = row.value.trim() === '' ? Number.NaN : Number(row.value)
        if (!Number.isFinite(value)) {
          errors[index] = 'Enter a valid number'
          return
        }
        parsed.push({ key: row.key, enabled: row.enabled, value, bookmarked: row.bookmarked })
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
    }, [set, dirty, rows, thesis, onSave, disabled])

    useImperativeHandle(ref, () => ({ save }), [save])

    const entries = useMemo(
      () =>
        rows
          .map((row, index) => ({ row, index }))
          .filter(({ row }) => categoryOf(row.key) === selected)
          .filter(({ row }) => !bookmarkedOnly || row.bookmarked)
          .sort((a, b) => Number(b.row.bookmarked) - Number(a.row.bookmarked)),
      [rows, categoryOf, selected, bookmarkedOnly],
    )

    const options = useMemo(
      () =>
        selected === null
          ? []
          : ratios.filter(
              (ratio) =>
                ratio.category === selected && !rows.some((row) => row.key === ratio.key),
            ),
      [ratios, selected, rows],
    )

    return (
      <Accordion.Root
        multiple
        collapsible
        value={open ? ['editor'] : []}
        onValueChange={(details) => onOpenChange(details.value.includes('editor'))}
      >
        <Accordion.Item
          value="editor"
          className="rounded-b-lg border border-t-0 border-border bg-card"
        >
          <Accordion.ItemTrigger className="px-4 py-4">
            <Text flex="1" fontSize="sm" fontWeight="semibold">
              Criteria{set !== null ? ` · ${set.name}` : ''}
            </Text>
            <Accordion.ItemIndicator />
          </Accordion.ItemTrigger>
          <Accordion.ItemContent className="px-4 pt-1 pb-5">
            <Accordion.ItemBody>
              {set === null ? (
                <Text fontSize="sm" color="fg.muted">
                  Loading criteria…
                </Text>
              ) : (
                <fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0">
                  <Stack gap={4}>
                    {open && bookmarkedItems.length > 0 ? (
                      <Suspense fallback={null}>
                        <RibbonRail items={bookmarkedItems} onSelect={handleRibbonSelect} />
                      </Suspense>
                    ) : null}
                    <Flex justify="flex-end">
                      <Button
                        size="xs"
                        variant={bookmarkedOnly ? 'subtle' : 'outline'}
                        colorPalette={bookmarkedOnly ? 'sakura' : undefined}
                        aria-pressed={bookmarkedOnly}
                        onClick={() => setBookmarkedOnly((value) => !value)}
                      >
                        Bookmarked only
                      </Button>
                    </Flex>

                    {selected === null ? (
                      <Text fontSize="sm" color="fg.muted">
                        No bookmarked criteria yet.
                      </Text>
                    ) : (
                      <Flex gap={5} align="flex-start" direction={{ base: 'column', lg: 'row' }}>
                        <Box flexShrink={0} w={{ base: '100%', lg: '15rem' }} pt={1}>
                          <CategoryDial
                            segments={segments}
                            value={selected}
                            onValueChange={disabled ? () => {} : setPick}
                            reduced={reduced}
                          />
                        </Box>
                        <Box flex="1" minW={0}>
                          <Box className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {entries.map(({ row, index }) => {
                              const spec = catalog.get(row.key)
                              const label = spec?.label ?? row.key
                              return (
                                <CriterionCard
                                  key={row.key}
                                  row={row}
                                  spec={spec}
                                  label={label}
                                  error={rowErrors[index]}
                                  index={index}
                                  reduced={reduced}
                                  onToggleEnabled={(enabled) => toggleRow(row.key, enabled)}
                                  onChangeValue={(value) => setRowValue(row.key, value)}
                                  onToggleBookmark={() => toggleBookmark(row.key)}
                                  onRemove={() => removeRow(row.key)}
                                />
                              )
                            })}
                            {options.length > 0 || selected === OTHER_CATEGORY ? (
                              <Box className="glass-card glass-card-add" p={3}>
                                <AddCriterion
                                  category={selected}
                                  options={options}
                                  onAdd={addRatio}
                                />
                              </Box>
                            ) : null}
                          </Box>
                        </Box>
                      </Flex>
                    )}

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
                      disabled={disabled}
                      onClick={() => void save()}
                    >
                      Save
                    </Button>
                  </Stack>
                </fieldset>
              )}
            </Accordion.ItemBody>
          </Accordion.ItemContent>
        </Accordion.Item>
      </Accordion.Root>
    )
  },
)

export default CriteriaEditor
