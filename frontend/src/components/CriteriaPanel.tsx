import { Badge, Box, Button, Flex, Text, Wrap, WrapItem } from "@chakra-ui/react"
import type { ScreenConfig } from "@/api/types"

const LABELS: Record<string, (v: number) => string> = {
  pe_max: (v) => `PE ≤ ${v}`,
  pb_max: (v) => `PB ≤ ${v}`,
  roe_min: (v) => `ROE ≥ ${v}%`,
  roce_min: (v) => `ROCE ≥ ${v}%`,
  debt_to_equity_max: (v) => `D/E ≤ ${v}`,
  market_cap_min: (v) => `Mkt Cap ≥ ₹${v}cr`,
}

export function CriteriaPanel({
  config,
  onReload,
  reloading = false,
  error = null,
}: {
  config: ScreenConfig | null
  onReload: () => void
  reloading?: boolean
  error?: string | null
}) {
  return (
    <Box borderWidth="1px" borderColor="border" rounded="lg" p={4} bg="bg.panel">
      <Flex justify="space-between" align="center" mb={2}>
        <Text fontWeight="semibold" fontSize="sm">
          Screening Criteria
        </Text>
        <Button size="sm" variant="outline" loading={reloading} onClick={onReload}>
          Reload config
        </Button>
      </Flex>
      {config === null ? (
        <Text fontSize="sm" color="fg.muted">
          Criteria unavailable
        </Text>
      ) : (
        <Wrap gap={2}>
          {Object.entries(config.criteria).map(([key, value]) => (
            <WrapItem key={key}>
              <Badge variant="subtle">
                {LABELS[key] ? LABELS[key](value) : `${key}: ${value}`}
              </Badge>
            </WrapItem>
          ))}
          <WrapItem>
            <Badge variant="outline">Top {config.shortlist_size}</Badge>
          </WrapItem>
        </Wrap>
      )}
      <Text mt={2} fontSize="xs" color="fg.muted">
        Edit <code>backend/config/screening.yaml</code>, then Reload config.
      </Text>
      {error ? (
        <Text mt={2} fontSize="sm" color="fg.error" role="alert">
          {error}
        </Text>
      ) : null}
    </Box>
  )
}
