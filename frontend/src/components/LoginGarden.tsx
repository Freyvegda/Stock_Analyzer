import { lazy, memo, Suspense } from 'react'
import { Flex } from '@chakra-ui/react'
import { ThemeToggle } from './ThemeToggle'

const SakuraScene = lazy(() => import('@/components/three/SakuraScene'))

/**
 * Static scene layer for `/login`: the Sakura Garden canvas plus the colour-mode
 * switch that picks moon or sun. Prop-free and memoised, so typing in the auth card
 * never re-renders the scene or the theme menu.
 */
export const LoginGarden = memo(function LoginGarden() {
  return (
    <>
      <Suspense fallback={null}>
        <SakuraScene />
      </Suspense>
      <Flex position="absolute" top={4} right={4} zIndex={2}>
        <ThemeToggle />
      </Flex>
    </>
  )
})

export default LoginGarden
