/** 回答分节卡（09-11 治理轮 P2，参考 sparkdesign ai-search 模板消息结构）：
 *  sources=引用来源卡 / related=相关追问 / images=图片行；每节=图标+标签头+内容。
 *  数据缺席时整节不渲染（不伪造空节）。 */
import { ArrowRight, FileSearch, Image as ImageIcon } from "lucide-react"

export interface SourceItem {
  title: string
  url?: string
  content: string
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 pt-2 text-xs font-medium text-muted-foreground">
      {icon}
      <span>{label}</span>
    </div>
  )
}

export function SourcesSection({ items }: { items: SourceItem[] }) {
  if (items.length === 0) return null
  return (
    <section>
      <SectionHeader icon={<FileSearch className="size-3.5" aria-hidden />} label={`来源（${items.length}）`} />
      <ul className="mt-1 space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="rounded-md border bg-surface px-2 py-1.5">
            <div className="flex items-center gap-2 text-xs font-medium">
              <span className="truncate">{s.title}</span>
              {s.url && (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="ml-auto shrink-0 truncate text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  {s.url.replace(/^https?:\/\//, "").slice(0, 40)}
                </a>
              )}
            </div>
            <p className="mt-0.5 line-clamp-3 text-[11px] leading-5 text-muted-foreground">{s.content}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function RelatedSection({ items, onPick }: { items: string[]; onPick: (q: string) => void }) {
  if (items.length === 0) return null
  return (
    <section>
      <SectionHeader icon={<ArrowRight className="size-3.5" aria-hidden />} label="相关追问" />
      <ul className="mt-1 space-y-1">
        {items.map((q, i) => (
          <li key={i}>
            <button
              type="button"
              className="flex w-full items-center gap-1.5 rounded-md border bg-surface px-2 py-1.5 text-left text-xs hover:border-brand/60 hover:bg-muted/40"
              onClick={() => onPick(q)}
            >
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{q}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ImagesSection({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null
  return (
    <section>
      <SectionHeader icon={<ImageIcon className="size-3.5" aria-hidden />} label={`图片（${urls.length}）`} />
      <div className="mt-1 flex flex-wrap gap-2">
        {urls.map((u, i) => (
          <a key={i} href={u} target="_blank" rel="noreferrer noopener" className="block">
            <img
              src={u}
              alt={`结果图片 ${i + 1}`}
              className="size-20 rounded-md border object-cover"
              loading="lazy"
            />
          </a>
        ))}
      </div>
    </section>
  )
}
