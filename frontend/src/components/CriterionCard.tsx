/**
 * Criterion flashcard — one ratio criterion as a glass card inside its category
 * grid. Bookmarked cards carry the sakura edge + filled ribbon; disabled cards
 * dim with a dashed edge; the threshold stays a direct-edit mono value chip.
 * Entrance staggers 12 ms per card (cap 8) and is static under reduced motion.
 */

import { Box, Flex, IconButton, Input, Switch, Text } from '@chakra-ui/react'
import { Bookmark, X } from 'lucide-react'
import { motion } from 'motion/react'
import type { RatioSpec } from '@/api/types'

export interface CriterionCardRow {
  key: string
  enabled: boolean
  value: string
  bookmarked: boolean
}

export interface CriterionCardProps {
  row: CriterionCardRow
  spec: RatioSpec | undefined
  label: string
  error?: string
  index: number
  reduced: boolean
  onToggleEnabled: (enabled: boolean) => void
  onChangeValue: (value: string) => void
  onToggleBookmark: () => void
  onRemove: () => void
}

export function CriterionCard({
  row,
  spec,
  label,
  error,
  index,
  reduced,
  onToggleEnabled,
  onChangeValue,
  onToggleBookmark,
  onRemove,
}: CriterionCardProps) {
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={reduced ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: reduced ? 0 : Math.min(index, 7) * 0.012 }}
    >
      <Box
        data-testid="criterion-card"
        data-criterion={row.key}
        data-bookmarked={row.bookmarked ? 'true' : undefined}
        data-disabled={!row.enabled ? 'true' : undefined}
        className="glass-card"
        p={3}
      >
        <Flex justify="space-between" align="flex-start" gap={2}>
          <Box minW={0}>
            <Text fontSize="sm" fontWeight="semibold" truncate>
              {label}
            </Text>
            {spec !== undefined ? (
              <Text fontSize="xs" color="fg.muted">
                {spec.unit}
              </Text>
            ) : null}
          </Box>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={row.bookmarked ? `Remove bookmark ${label}` : `Bookmark ${label}`}
            onClick={onToggleBookmark}
          >
            <Bookmark
              size={14}
              strokeWidth={1.75}
              aria-hidden="true"
              fill={row.bookmarked ? 'currentColor' : 'none'}
              className={row.bookmarked ? 'text-primary' : undefined}
            />
          </IconButton>
        </Flex>

        <Flex mt={3} align="center" gap={2}>
          <Switch.Root checked={row.enabled} onCheckedChange={(details) => onToggleEnabled(details.checked)}>
            <Switch.HiddenInput aria-label={label} />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
          {spec !== undefined ? (
            <Text fontSize="sm" color="fg.muted" aria-hidden="true">
              {spec.direction === 'min' ? '≥' : '≤'}
            </Text>
          ) : null}
          <Input
            size="sm"
            maxW="24"
            ml="auto"
            textAlign="right"
            inputMode="decimal"
            aria-label={`${label} value`}
            value={row.value}
            onChange={(e) => onChangeValue(e.target.value)}
            className="font-mono tabular-nums"
          />
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
          >
            <X size={14} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        </Flex>

        {error !== undefined ? (
          <Text fontSize="xs" color="fg.error" mt={1}>
            {error}
          </Text>
        ) : null}
      </Box>
    </motion.div>
  )
}

export default CriterionCard
