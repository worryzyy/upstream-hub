"use client"

import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useDashboardSummary, useChannels } from "@/lib/queries"
import { channelTypeLabel, ratioDelta, relativeTime, shortTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useMemo } from "react"

export function MultiplierChanges() {
  const summary = useDashboardSummary()
  const channels = useChannels()

  const channelMap = useMemo(() => {
    const m = new Map<number, { name: string; type: string }>()
    for (const c of channels.data ?? []) m.set(c.id, { name: c.name, type: c.type })
    return m
  }, [channels.data])

  const items = summary.data?.recent_rate_changes ?? []

  return (
    <Card className="max-h-100 min-h-0 overflow-hidden border border-border shadow-none lg:h-100">
      <CardHeader className="flex shrink-0 flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold">{"最近倍率变动"}</CardTitle>
        <span className="text-xs text-muted-foreground">{items.length > 0 ? `${items.length} 条` : ""}</span>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 px-0">
        {summary.loading ? (
          <p className="px-6 py-6 text-xs text-muted-foreground">{"加载中…"}</p>
        ) : items.length === 0 ? (
          <p className="px-6 py-6 text-xs text-muted-foreground">{"暂无倍率变动记录"}</p>
        ) : (
          <ScrollArea type="hover" className="h-full">
            <ul className="divide-y divide-border">
              {items.map((m) => {
                const ch = channelMap.get(m.channel_id)
                const delta = ratioDelta(m.old_ratio, m.new_ratio)
                const isUp = delta.direction === "up"
                const chType = ch?.type ?? ""
                return (
                  <li key={m.id} className="flex items-start gap-3 px-6 py-3.5">
                    <div className="flex flex-col items-center gap-0.5 pt-1">
                      <span className={cn("size-2 rounded-full", isUp ? "bg-danger" : "bg-success")} />
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground leading-relaxed">
                      <p>{relativeTime(m.changed_at)}</p>
                      <p>{shortTime(m.changed_at)}</p>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{m.model_name}</span>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                            chType === "newapi"
                              ? "bg-brand/10 text-brand ring-brand/20"
                              : "bg-foreground/5 text-foreground ring-border",
                          )}
                        >
                          {ch?.name ?? `#${m.channel_id}`}
                          {chType ? <span className="ml-1 opacity-60">{channelTypeLabel(chType)}</span> : null}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center text-xs">
                        <div>
                          <span className="text-muted-foreground">{"倍率"}</span>
                          <p className="mt-0.5 tabular-nums">
                            <span className="text-muted-foreground">
                              {m.old_ratio == null ? "—" : m.old_ratio.toFixed(2)}
                            </span>
                            <span className="mx-1 text-muted-foreground">{"→"}</span>
                            <span className={cn("font-medium", isUp ? "text-danger" : "text-success")}>
                              {m.new_ratio.toFixed(2)}
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 pt-0.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-xs font-semibold",
                          isUp ? "bg-danger/10 text-danger" : "bg-success/10 text-success",
                        )}
                      >
                        {isUp ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                        {delta.pct}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
