import { Braces, Clock, Database, GitBranch, Inbox } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { AgentDetail } from "@/domain/types"

export interface VariableOption {
  group: "INPUT" | "UPSTREAM" | "STATE" | "SYSTEM"
  key: string
  type: string
}

/** 变量来源：Input / Upstream Outputs / State / System（Master §8.7）。 */
export function collectVariables(agent: AgentDetail | null, upstreamNodeNames: string[]): VariableOption[] {
  const options: VariableOption[] = []
  for (const input of agent?.inputSchema ?? []) {
    options.push({ group: "INPUT", key: input.key, type: input.type })
  }
  for (const name of upstreamNodeNames) {
    options.push({ group: "UPSTREAM", key: `${name}.output`, type: "Object" })
  }
  options.push({ group: "STATE", key: "state.shared_context", type: "Object" })
  options.push({ group: "SYSTEM", key: "system.trace_id", type: "String" })
  options.push({ group: "SYSTEM", key: "system.now", type: "DateTime" })
  return options
}

const groupIcon = {
  INPUT: Inbox,
  UPSTREAM: GitBranch,
  STATE: Database,
  SYSTEM: Clock,
} as const

/**
 * Variable Picker：普通用户不手写 state.xxx。
 * 结构化选择 INPUT / UPSTREAM / STATE / SYSTEM。
 */
export function VariablePicker({
  value,
  onChange,
  options,
  placeholder = "选择变量",
}: {
  value?: string
  onChange: (value: string) => void
  options: VariableOption[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const groups: VariableOption["group"][] = ["INPUT", "UPSTREAM", "STATE", "SYSTEM"]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-8 w-full justify-start gap-1 font-mono text-xs font-normal">
          <Braces className="size-3.5 text-muted-foreground" />
          {value || placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="搜索变量..." />
          <CommandList>
            <CommandEmpty>没有匹配的变量</CommandEmpty>
            {groups.map((group) => {
              const items = options.filter((o) => o.group === group)
              if (items.length === 0) return null
              const Icon = groupIcon[group]
              return (
                <CommandGroup key={group} heading={group}>
                  {items.map((item) => (
                    <CommandItem
                      key={`${item.group}.${item.key}`}
                      value={`${item.group} ${item.key}`}
                      onSelect={() => {
                        onChange(item.key)
                        setOpen(false)
                      }}
                    >
                      <Icon className="size-3.5 text-muted-foreground" />
                      <span className="font-mono text-xs">{item.key}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">{item.type}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
