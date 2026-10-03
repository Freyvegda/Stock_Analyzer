/**
 * Screening Criteria — saved-screen picker, the active screen's badges and the
 * inline criteria editor (no dialogs), plus the Run Screen card. Owns no run
 * state: everything comes from the layout outlet context so a run keeps going
 * while the user browses the other rail pages.
 */

import { Suspense, lazy, useRef, useState } from 'react'
import { Button, Box, Flex, Text } from '@chakra-ui/react'
import { useOutletContext } from 'react-router-dom'
import { CriteriaEditor, type CriteriaEditorHandle } from '@/components/CriteriaEditor'
import { CriteriaPanel } from '@/components/CriteriaPanel'
import { RunProgress } from '@/components/RunProgress'
import { ScreenTabs, TABPANEL_ID, tabId } from '@/components/ScreenTabs'
import { BlurFade } from '@/components/ui/BlurFade'
import { NumberTicker } from '@/components/ui/NumberTicker'
import { Num } from '@/components/ui/Num'
import { formatElapsed } from '@/lib/format'
import type { Criterion, ScreeningSet } from '@/api/types'
import type { FundamentalsOutletContext } from './FundamentalsLayout'

const SakuraLeafLoader = lazy(() => import('@/components/three/SakuraLeafLoader'))

export default function ScreeningCriteria() {
  const {
    sets,
    activeSet,
    setsError,
    ratios,
    rows,
    summary,
    lastRunDate,
    job,
    busySetIds,
    starting,
    running,
    elapsed,
    runError,
    reloadSets,
    activateSet,
    createSet,
    updateSet,
    deleteSet,
    runScreen,
  } = useOutletContext<FundamentalsOutletContext>()

  const [editorOpen, setEditorOpen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [pendingSwitch, setPendingSwitch] = useState<ScreeningSet | null>(null)
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const editorRef = useRef<CriteriaEditorHandle>(null)
  const activeBusy = activeSet !== null && busySetIds.has(activeSet.id)

  const todayIso = (() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })()
  const storedDataDate =
    rows
      .map((r) => r.data_date)
      .filter((d): d is string => Boolean(d))
      .sort()[0] ?? null

  async function saveDraft(): Promise<boolean> {
    const save = editorRef.current?.save
    if (save === undefined) return true
    return save()
  }

  async function doActivate(target: ScreeningSet) {
    setSwitching(true)
    setSwitchError(null)
    try {
      await activateSet(target.id)
      setPendingSwitch(null)
    } catch (e) {
      setSwitchError(e instanceof Error ? e.message : 'Failed to switch screens')
    } finally {
      setSwitching(false)
    }
  }

  function requestSwitch(next: ScreeningSet) {
    if (next.id === activeSet?.id) return
    if (dirty) {
      setPendingSwitch(next)
      setSwitchError(null)
      return
    }
    void doActivate(next)
  }

  async function saveAndSwitch() {
    if (pendingSwitch === null) return
    const ok = await saveDraft()
    if (!ok) {
      setEditorOpen(true)
      return
    }
    await doActivate(pendingSwitch)
  }

  async function handleRun() {
    const ok = await saveDraft()
    if (!ok) {
      setEditorOpen(true)
      return
    }
    await runScreen()
  }

  async function handleSave(criteria: Criterion[], thesis: string | null) {
    if (activeSet === null) return
    await updateSet(activeSet.id, { criteria, thesis })
  }

  /** Rename/create replace the active set object; a dirty draft must be saved
   * (or fixed) first so edits never vanish silently. */
  async function ensureDraftSaved() {
    if (!dirty) return
    const ok = await saveDraft()
    if (!ok) {
      setEditorOpen(true)
      throw new Error('Fix the highlighted rows before switching actions')
    }
  }

  return (
    <div className="space-y-6">
      <Text as="h1" fontSize="xl" fontWeight="semibold">
        Screening Criteria
      </Text>

      <div>
        <Box
          data-testid="criteria-shell"
          className="overflow-hidden rounded-t-lg border border-b-0 border-border bg-card"
        >
          <Box className="px-4 pt-4">
            <ScreenTabs
              sets={sets}
              active={activeSet}
              dirty={dirty}
              busy={switching}
              busySetIds={busySetIds}
              onSelect={requestSwitch}
              onCreate={async (name) => {
                await ensureDraftSaved()
                await createSet(name)
              }}
              onRename={async (set, name) => {
                await ensureDraftSaved()
                await updateSet(set.id, { name })
              }}
              onDelete={async (set) => {
                if (set.id === activeSet?.id) setEditorOpen(false)
                await deleteSet(set.id)
              }}
            />
          </Box>

          <Box
            role="tabpanel"
            id={TABPANEL_ID}
            aria-labelledby={activeSet !== null ? tabId(activeSet.id) : undefined}
            className="px-4 pt-5 pb-5"
          >
            <CriteriaPanel
              set={activeSet}
              ratios={ratios}
              locked={activeBusy}
              onEdit={() => setEditorOpen(true)}
              onRetry={() => void reloadSets()}
              error={setsError}
            />
          </Box>
        </Box>

        {pendingSwitch !== null ? (
          <Flex
            role="alert"
            align="center"
            gap={3}
            wrap="wrap"
            borderWidth="1px"
            borderColor="border"
            rounded="lg"
            px={4}
            py={3}
            my={3}
            bg="bg.panel"
          >
            <Text fontSize="sm" flex="1">
              Unsaved changes — save them before switching to {pendingSwitch.name}?
            </Text>
            <Button size="sm" colorPalette="sakura" loading={switching} onClick={() => void saveAndSwitch()}>
              Save &amp; switch
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={switching}
              onClick={() => void doActivate(pendingSwitch)}
            >
              Discard &amp; switch
            </Button>
            <Button size="sm" variant="ghost" disabled={switching} onClick={() => setPendingSwitch(null)}>
              Cancel
            </Button>
          </Flex>
        ) : null}

        {switchError !== null ? (
          <Text role="alert" color="fg.error" fontSize="sm" my={3}>
            {switchError}
          </Text>
        ) : null}

        {/* Flush against the shell: the editor's accordion item drops its top
            edge, so tabs → criteria summary → editor read as one card stack. */}
        <CriteriaEditor
          ref={editorRef}
          open={editorOpen}
          onOpenChange={setEditorOpen}
          set={activeSet}
          ratios={ratios}
          disabled={activeBusy}
          onSave={handleSave}
          onDirtyChange={setDirty}
        />
      </div>

      <BlurFade>
        <div className="relative overflow-hidden rounded-lg border border-border bg-card p-4">
          <Flex align="center" gap={4} wrap="wrap">
            <Button colorPalette="sakura" disabled={running} onClick={() => void handleRun()}>
              {running ? 'Running…' : 'Run Screen'}
            </Button>
            {summary !== null ? (
              <Text data-testid="summary" fontSize="sm" color="fg.muted">
                <Num>
                  <NumberTicker value={summary.shortlisted} />
                </Num>{' '}
                shortlisted ·{' '}
                <Num>
                  <NumberTicker value={summary.failed} />
                </Num>{' '}
                failed ·{' '}
                <Num>
                  <NumberTicker value={summary.total} />
                </Num>{' '}
                total
              </Text>
            ) : lastRunDate !== null ? (
              <Text data-testid="summary" fontSize="sm" color="fg.muted">
                Last run: {lastRunDate}
              </Text>
            ) : null}
            {storedDataDate !== null && storedDataDate !== todayIso ? (
              <Text data-testid="data-as-of" fontSize="sm" color="fg.muted">
                Data as of {storedDataDate}
              </Text>
            ) : null}
          </Flex>

          {job !== null ? (
            <div className="mt-4">
              <RunProgress job={job} />
            </div>
          ) : null}

          {starting ? (
            <div className="mt-4 flex flex-col items-center gap-2">
              <Suspense fallback={null}>
                <SakuraLeafLoader size={120} label="Running screen…" />
              </Suspense>
              <Text fontSize="sm" color="fg.muted">
                Fetching fundamentals for ~500 stocks — takes a few minutes
              </Text>
              <Text fontSize="sm" color="fg.muted">
                <span data-testid="elapsed">
                  <Num>{formatElapsed(elapsed)}</Num>
                </span>
              </Text>
            </div>
          ) : null}
        </div>
      </BlurFade>

      {/* CriteriaPanel already renders load failures with role="alert"; avoid a duplicate alert. */}
      {runError !== null && setsError === null ? (
        <Text role="alert" color="fg.error" fontSize="sm">
          {runError}
        </Text>
      ) : null}
    </div>
  )
}
