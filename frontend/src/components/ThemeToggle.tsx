"use client"

import { IconButton, Menu, Portal } from "@chakra-ui/react"
import { Check, Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import type { MouseEvent } from "react"
import { useColorMode, type ColorMode } from "@/components/ui/color-mode"
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion"

const OPTIONS: { value: ColorMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> }
}

export function ThemeToggle() {
  const { colorMode } = useColorMode()
  const { theme, setTheme } = useTheme()
  const reduced = usePrefersReducedMotion()
  const TriggerIcon = colorMode === "dark" ? Moon : Sun

  function selectTheme(value: ColorMode, event: MouseEvent<HTMLElement>) {
    const doc = document as ViewTransitionDocument
    if (reduced || typeof doc.startViewTransition !== "function") {
      setTheme(value)
      return
    }
    document.documentElement.style.setProperty("--vt-x", `${event.clientX}px`)
    document.documentElement.style.setProperty("--vt-y", `${event.clientY}px`)
    doc.startViewTransition(() => setTheme(value))
  }

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton aria-label="Color mode" variant="ghost" size="sm">
          <TriggerIcon size={16} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content>
            {OPTIONS.map((option) => {
              const Icon = option.icon
              const selected = theme === option.value
              return (
                <Menu.Item
                  key={option.value}
                  value={option.value}
                  onClick={(event) => selectTheme(option.value, event)}
                >
                  <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span>{option.label}</span>
                  {selected ? (
                    <Check size={14} strokeWidth={1.75} aria-hidden="true" />
                  ) : null}
                </Menu.Item>
              )
            })}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}
