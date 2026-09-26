import { memo } from 'react'
import { Flex, Stack, Text } from '@chakra-ui/react'
import { TrendingUp } from 'lucide-react'
import { Num } from './ui/Num'

const PIPELINE = [
  { label: 'Fundamental screen', detail: 'Your criteria, run across the Nifty 500.' },
  { label: 'Document analysis', detail: 'Concall and result notes, summarised.' },
  { label: 'Signals & backtest', detail: 'XGBoost signals, walked forward.' },
]

/**
 * The story half of the login screen: wordmark, positioning line and the three
 * pipeline stages. Static by design, so it sits in a memoised component and never
 * re-renders while the auth form changes. Hidden below `lg` — phones get the card.
 */
export const LoginBrandPanel = memo(function LoginBrandPanel() {
  return (
    <Stack display={{ base: 'none', lg: 'flex' }} flex="1" maxW="lg" gap={7}>
      <Flex align="center" gap={2}>
        <TrendingUp size={20} strokeWidth={1.75} className="text-primary" aria-hidden="true" />
        <Text fontSize="sm" fontWeight="semibold" letterSpacing="0.14em">
          STOCK ANALYZER
        </Text>
      </Flex>
      <Stack gap={3}>
        <Text as="h2" fontSize="4xl" fontWeight="semibold" lineHeight="1.1">
          Read the whole Nifty 500.
        </Text>
        <Text color="fg.muted" maxW="md">
          A private screening desk: fundamentals first, documents next, price signals last — every
          stage on your own machine.
        </Text>
      </Stack>
      <Stack gap={4}>
        {PIPELINE.map((step, index) => (
          <Flex key={step.label} gap={3} align="baseline">
            <Num className="text-xs text-primary">{`0${index + 1}`}</Num>
            <Stack gap={0}>
              <Text fontSize="sm" fontWeight="medium">
                {step.label}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {step.detail}
              </Text>
            </Stack>
          </Flex>
        ))}
      </Stack>
    </Stack>
  )
})

export default LoginBrandPanel
