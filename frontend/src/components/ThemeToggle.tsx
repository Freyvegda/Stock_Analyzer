"use client"

import { IconButton, Menu, Portal } from "@chakra-ui/react"
import { Check, Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useColorMode, type ColorMode } from "@/components/ui/color-mode"

const OPTIONS: { value: ColorMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

export function ThemeToggle() {
  const { colorMode } = useColorMode()
  const { theme, setTheme } = useTheme()
  const TriggerIcon = colorMode === "dark" ? Moon : Sun

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
                  onClick={() => setTheme(option.value)}
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
