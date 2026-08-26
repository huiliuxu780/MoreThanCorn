/** 07-SDD V1.5：shadcn 标准字段控件（日期/附件/多选下拉），构建器预览与运行时渲染共用。 */
import { CalendarIcon, Check, ChevronsUpDown, Paperclip, X } from "lucide-react"
import * as React from "react"
import { format } from "date-fns"

import { Calendar } from "@/components/ui/calendar"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/* 日期/日期时间：Popover + shadcn Calendar */
export function DatePicker({ value, onChange, withTime = false, placeholder = "选择日期" }: {
  value?: string; onChange: (v: string) => void; withTime?: boolean; placeholder?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [time, setTime] = React.useState(value?.includes("T") ? value.slice(11, 16) : "09:00")
  const date = value ? new Date(value) : undefined
  const commit = (d: Date) => {
    const v = withTime ? `${format(d, "yyyy-MM-dd")}T${time}` : format(d, "yyyy-MM-dd")
    onChange(v)
  }
  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn("h-8 flex-1 justify-start text-left font-normal text-xs", !value && "text-muted-foreground")}>
            <CalendarIcon className="mr-2 size-3.5" />
            {value ? value.replace("T", " ") : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date && !isNaN(date.getTime()) ? date : undefined}
            onSelect={(d) => { if (d) { commit(d); if (!withTime) setOpen(false) } }}
          />
          {withTime && (
            <div className="border-t p-2">
              <input type="time" className="h-7 rounded-md border px-2 text-xs" value={time}
                onChange={(e) => { setTime(e.target.value); if (date && !isNaN(date.getTime())) onChange(`${format(date, "yyyy-MM-dd")}T${e.target.value}`) }} />
            </div>
          )}
        </PopoverContent>
      </Popover>
      {value && <Button variant="ghost" size="sm" onClick={() => onChange("")}><X className="size-3" /></Button>}
    </div>
  )
}

/* 附件：shadcn 风格上传按钮（隐藏原生 input） */
export function FilePick({ value, onChange, placeholder = "上传附件" }: {
  value?: string; onChange: (v: string) => void; placeholder?: string
}) {
  const ref = React.useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-2">
      <input ref={ref} type="file" className="hidden"
        onChange={(e) => onChange(e.target.files?.[0]?.name ?? "")} />
      <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => ref.current?.click()}>
        <Paperclip className="size-3.5" /> {placeholder}
      </Button>
      {value && (
        <span className="flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
          {value}
          <button onClick={() => onChange("")}><X className="size-3 text-neutral-400" /></button>
        </span>
      )}
    </div>
  )
}

/* 下拉多选：Popover + Command + Checkbox + 已选 badges */
export function MultiSelect({ options, values, onChange, placeholder = "请选择" }: {
  options: { label: string; value: string }[]; values: string[]; onChange: (v: string[]) => void; placeholder?: string
}) {
  const [open, setOpen] = React.useState(false)
  const toggle = (v: string) =>
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-8 w-full justify-between text-left font-normal text-xs" role="combobox" aria-expanded={open}>
          <span className="flex flex-1 flex-wrap gap-1 overflow-hidden">
            {values.length === 0 && <span className="text-muted-foreground">{placeholder}</span>}
            {values.map((v) => (
              <span key={v} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600">
                {options.find((o) => o.value === v)?.label ?? v}
              </span>
            ))}
          </span>
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0">
        <Command>
          <CommandList>
            <CommandEmpty>无选项</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)}>
                  <Check className={cn("mr-2 size-3.5", values.includes(o.value) ? "opacity-100" : "opacity-0")} />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
