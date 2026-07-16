"use client"

import { useState } from "react"
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useBalanceTrend, useDashboardSummary, type BalanceTrendRange } from "@/lib/queries"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"

function formatY(n: number) {
  if (n === 0) return "$0"
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  if (n >= 100) return `$${n.toFixed(0)}`
  return `$${n.toFixed(n >= 10 ? 1 : 2)}`
}

/**
 * niceCeil 把最大值向上取整到一个"好看的"刻度，避免曲线贴顶。
 * 例如 47 → 50；478 → 500；12,300 → 15,000。
 */
function niceCeil(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 10
  const padded = n * 1.15
  const mag = Math.pow(10, Math.floor(Math.log10(padded)))
  const norm = padded / mag
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  return step * mag
}

function formatDay(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function formatHour(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const now = new Date()
  const time = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return time
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

interface TooltipPayloadItem { value: number }

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold text-foreground">
        {"$"}{payload[0].value.toLocaleString("en-US")}
      </p>
    </div>
  )
}

export function BalanceOverview() {
  const [range, setRange] = useState<BalanceTrendRange>("7d")
  const trend = useBalanceTrend(range)
  const summary = useDashboardSummary()

  const data = (trend.data ?? []).map((p) => ({
    day: range === "24h" ? formatHour(p.day) : formatDay(p.day),
    balance: p.balance,
  }))

  const channels = summary.data?.channels ?? []
  const yMax = data.length > 0 ? niceCeil(Math.max(...data.map((d) => d.balance))) : 10

  return (
    <Card className="border border-border shadow-none lg:h-100">
      <CardHeader className="flex shrink-0 flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold">{"余额概览"}</CardTitle>
        <div className="inline-flex shrink-0 rounded-md border border-border bg-muted/30 p-0.5">
          {([
            ["7d", "7 天"],
            ["24h", "24 小时"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setRange(value)}
              className={cn(
                "h-6 rounded px-2 text-xs transition-colors",
                range === value
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 w-full flex-1">
          {trend.loading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{"加载中…"}</div>
          ) : data.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {range === "24h" ? "暂无 24 小时余额采样，等待下次扫描或手动刷新" : "暂无余额采样，等待下次扫描或手动刷新"}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  dy={8}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickFormatter={formatY}
                  domain={[0, yMax]}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border)", strokeDasharray: "4 4" }} />
                <Line
                  type="monotone"
                  dataKey="balance"
                  stroke="var(--brand)"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "var(--background)", stroke: "var(--brand)", strokeWidth: 2 }}
                  activeDot={{ r: 5, fill: "var(--brand)", strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* per-channel chips */}
        {channels.length > 0 ? (
          <div className="mt-3 flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3">
            {channels.map((c) => {
              const isFailed = !!c.last_error
              const isUnknown = c.last_balance == null
              return (
                <span key={c.id} className="inline-flex items-center gap-1.5 text-xs">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      isFailed ? "bg-danger" : isUnknown ? "bg-muted-foreground/40" : "bg-success",
                    )}
                  />
                  <span className="font-medium text-foreground">{c.name}</span>
                  <span className="tabular-nums text-muted-foreground">{money(c.last_balance)}</span>
                </span>
              )
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
