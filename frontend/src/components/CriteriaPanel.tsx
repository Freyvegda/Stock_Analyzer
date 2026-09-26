import { Badge, Box, Button, Flex, Text, Wrap, WrapItem } from "@chakra-ui/react"
import type { RatioSpec, UserCriteria } from "@/api/types"

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
  criteria,
  ratios,
  onEdit,
  error = null,
}: {
  criteria: UserCriteria | null
  ratios: RatioSpec[]
  onEdit: () => void
  error?: string | null
}) {
  const catalog = new Map(ratios.map((ratio) => [ratio.key, ratio]))
  const enabled = criteria?.criteria.filter((criterion) => criterion.enabled) ?? []

  return (
    <Box borderWidth="1px" borderColor="border" rounded="lg" p={4} bg="bg.panel">
      <Flex justify="space-between" align="center" mb={2} gap={4}>
        <Text fontWeight="semibold" fontSize="sm">
          Screening Criteria
        </Text>
        <Button size="sm" colorPalette="emerald" onClick={onEdit}>
          Edit Criteria
        </Button>
      </Flex>
      {criteria === null ? (
        <Text fontSize="sm" color="fg.muted">
          Loading criteria…
        </Text>
      ) : (
        <Wrap gap={2}>
          {enabled.map((criterion) => (
            <WrapItem key={criterion.key}>
              <Badge variant="subtle">
                {badgeText(catalog.get(criterion.key), criterion.key, criterion.value)}
              </Badge>
            </WrapItem>
          ))}
          <WrapItem>
            <Badge variant="outline">Top {criteria.shortlist_size}</Badge>
          </WrapItem>
        </Wrap>
      )}
      {error ? (
        <Text mt={2} fontSize="sm" color="fg.error" role="alert">
          {error}
        </Text>
      ) : null}
    </Box>
  )
}
