/**
 * Active screen's enabled-ratio summary — the cross-category view above the
 * inline editor (the editor shows one category at a time). The owning page
 * renders it inside the merged tabs+panel shell, so this component paints no
 * frame of its own.
 */

import { Badge, Box, Button, Flex, Text, Wrap, WrapItem } from '@chakra-ui/react'
import { Bookmark } from 'lucide-react'
import type { RatioSpec, ScreeningSet } from '@/api/types'

/** '%' and '×' attach directly; other units get a space (e.g. "1000 ₹ cr"). */
function unitSuffix(unit: string): string {
  if (unit === '%' || unit === '×') return unit
  return unit === '' ? '' : ` ${unit}`
}

function badgeText(spec: RatioSpec | undefined, key: string, value: number): string {
  if (spec === undefined) return `${key}: ${value}`
  const sign = spec.direction === 'min' ? '≥' : '≤'
  return `${spec.label} ${sign} ${value}${unitSuffix(spec.unit)}`
}

export function CriteriaPanel({
  set,
  ratios,
  onEdit,
  onRetry,
  error = null,
}: {
  set: ScreeningSet | null
  ratios: RatioSpec[]
  onEdit: () => void
  onRetry?: () => void
  error?: string | null
}) {
  const catalog = new Map(ratios.map((ratio) => [ratio.key, ratio]))
  const enabled = set?.criteria.filter((criterion) => criterion.enabled) ?? []
  const bookmarked = enabled.filter((criterion) => criterion.bookmarked).length

  return (
    <Box>
      <Flex justify="space-between" align="center" mb={2} gap={4}>
        <Box>
          <Text fontWeight="semibold" fontSize="sm">
            {set !== null ? set.name : 'Screening Criteria'}
          </Text>
          {set !== null ? (
            <Text fontSize="xs" color="fg.muted" data-testid="panel-summary">
              {enabled.length} enabled · {bookmarked} bookmarked
            </Text>
          ) : null}
        </Box>
        <Button size="sm" colorPalette="sakura" onClick={onEdit} disabled={set === null}>
          Edit Criteria
        </Button>
      </Flex>
      {set === null ? (
        <Text fontSize="sm" color="fg.muted">
          Loading criteria…
        </Text>
      ) : (
        <Wrap gap={2}>
          {enabled.map((criterion) => (
            <WrapItem key={criterion.key}>
              <Badge
                variant="subtle"
                colorPalette="sakura"
                display="inline-flex"
                alignItems="center"
                gap="1"
                className="font-mono tabular-nums"
              >
                {criterion.bookmarked ? (
                  <Bookmark
                    size={12}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    fill="currentColor"
                  />
                ) : null}
                {badgeText(catalog.get(criterion.key), criterion.key, criterion.value)}
              </Badge>
            </WrapItem>
          ))}
          <WrapItem>
            <Badge variant="outline">Top {set.shortlist_size}</Badge>
          </WrapItem>
        </Wrap>
      )}
      {error ? (
        <Flex align="center" gap={3} mt={2} wrap="wrap">
          <Text fontSize="sm" color="fg.error" role="alert">
            {error}
          </Text>
          {onRetry !== undefined ? (
            <Button size="xs" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </Flex>
      ) : null}
    </Box>
  )
}
