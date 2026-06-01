"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  LogIn,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { useChannels, useChannelRates } from "@/lib/queries"
import { apiFetch } from "@/lib/api"
import { useTriggerRefresh } from "@/lib/refresh-context"
import { channelTypeLabel, money, relativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { syncChannelStream, testLoginStream, type ProgressEvent } from "@/lib/sync-stream"
import type { Channel } from "@/lib/api-types"
import { ChannelFormDialog } from "@/components/monitor/channel-form-dialog"

type Status = "healthy" | "low" | "failed" | "idle"

function statusOf(c: Channel): Status {
  if (c.last_error) return "failed"
  if (c.last_balance == null) return "idle"
  if (c.balance_threshold > 0 && c.last_balance < c.balance_threshold) return "low"
  return "healthy"
}

const statusMap: Record<Status, { label: string; cls: string }> = {
  healthy: { label: "健康", cls: "text-success bg-success/10" },
  low: { label: "低余额", cls: "text-warning bg-warning/10" },
  failed: { label: "登录失败", cls: "text-danger bg-danger/10" },
  idle: { label: "尚未采集", cls: "text-muted-foreground bg-muted/40" },
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground">{children}</span>
    </div>
  )
}

/** ratioTone 按倍率给 chip 上色，与 ChannelRatesPanel 共用同一套规则。 */
function ratioTone(r: number): string {
  if (r <= 0.8) return "bg-success/10 text-success ring-success/20"
  if (r > 2) return "bg-danger/10 text-danger ring-danger/20"
  if (r > 1.2) return "bg-warning/10 text-warning ring-warning/20"
  return "bg-muted text-foreground ring-border"
}

/** InlineRates 在渠道卡片内部展示当前所有分组倍率，默认 2 行折叠 + 展开按钮。 */
function InlineRates({ channelID }: { channelID: number }) {
  const { data, loading } = useChannelRates(channelID)
  const rates = [...(data ?? [])].sort((a, b) => a.ratio - b.ratio)
  const [expanded, setExpanded] = useState(false)
  const [hasOverflow, setHasOverflow] = useState(false)
  const chipBoxRef = useRef<HTMLDivElement>(null)

  // 监听 chip 容器尺寸变化，决定是否要显示"展开"按钮。
  // 收起状态下 scrollHeight > clientHeight 表示有内容被裁剪。
  useEffect(() => {
    const el = chipBoxRef.current
    if (!el) return
    const check = () => {
      if (expanded) return
      setHasOverflow(el.scrollHeight > el.clientHeight + 1)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rates.length, expanded])

  if (loading) return null
  if (rates.length === 0) return null

  const showToggle = hasOverflow || expanded

  return (
    <div className="mt-3 border-t border-border pt-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {rates.length} 个分组
        </p>
        {showToggle ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {expanded ? "收起" : "展开"}
            <ChevronDown
              className={cn(
                "size-3 transition-transform duration-200",
                expanded && "rotate-180",
              )}
            />
          </button>
        ) : null}
      </div>

      <div className="relative">
        <div
          ref={chipBoxRef}
          className={cn(
            "flex flex-wrap gap-1 overflow-hidden transition-[max-height] duration-300 ease-out",
            // 收起：max-h-12 (~48px) 约 2 行；展开：足够大的上限，留点缓冲让 transition 不立即消失。
            expanded ? "max-h-150" : "max-h-12",
          )}
        >
          {rates.map((r) => (
            <Tooltip key={r.id} delayDuration={150}>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex cursor-default items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset transition-colors hover:bg-muted/60",
                    ratioTone(r.ratio),
                  )}
                >
                  <span className="font-medium">{r.model_name}</span>
                  <span className="font-semibold tabular-nums">{r.ratio.toFixed(2)}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                <p className="font-medium">{r.model_name}</p>
                {r.description ? (
                  <p className="mt-0.5 text-muted-foreground">{r.description}</p>
                ) : (
                  <p className="mt-0.5 italic text-muted-foreground">{"(无描述)"}</p>
                )}
                <p className="mt-0.5 text-muted-foreground">
                  {"最近更新："}
                  {relativeTime(r.last_seen_at)}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        {/* 折叠时底部淡出，提示还有更多内容 */}
        {!expanded && hasOverflow ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-linear-to-t from-background to-transparent" />
        ) : null}
      </div>
    </div>
  )
}

interface ChannelSyncState {
  running: boolean
  events: ProgressEvent[]
  latest: ProgressEvent | null
  finalOk: boolean | null
  fading: boolean
}

function emptySyncState(): ChannelSyncState {
  return { running: false, events: [], latest: null, finalOk: null, fading: false }
}

const stageLabel: Record<ProgressEvent["stage"], string> = {
  captcha: "打码",
  session: "会话",
  login: "登录",
  balance: "余额",
  rates: "倍率",
  done: "完成",
  error: "失败",
}

const stageOrder: Record<ProgressEvent["stage"], number> = {
  captcha: 1,
  session: 2,
  login: 3,
  balance: 4,
  rates: 5,
  done: 9,
  error: 9,
}

/** 按 stage 去重，每个 stage 只留最后一条事件（"在做中→完成"会被覆盖成完成态）。 */
function deriveSteps(events: ProgressEvent[]): ProgressEvent[] {
  const byStage = new Map<ProgressEvent["stage"], ProgressEvent>()
  for (const ev of events) byStage.set(ev.stage, ev)
  return [...byStage.values()].sort((a, b) => stageOrder[a.stage] - stageOrder[b.stage])
}

function SyncProgressStrip({ state }: { state: ChannelSyncState }) {
  if (!state.running && state.latest == null) return null
  const steps = deriveSteps(state.events)

  return (
    <div
      className={cn(
        "mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5",
        // 入场：上方滑入 + 淡入
        "animate-in fade-in slide-in-from-top-1 duration-300",
        // 出场：和 scheduleHide 里的 500ms 对齐
        "transition-all duration-500 ease-out",
        state.fading ? "-translate-y-0.5 opacity-0" : "opacity-100",
      )}
    >
      {steps.length === 0 ? (
        <div className="flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          <span className="text-foreground/80">{"准备中…"}</span>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {steps.map((ev) => {
            // 终止态：stage=done 或 error；显式 ok=true / false 也算
            const failed = ev.stage === "error" || ev.ok === false
            const succeeded = ev.stage === "done" || ev.ok === true
            const running = !failed && !succeeded
            const Icon = running ? Loader2 : failed ? XCircle : CheckCircle2
            const tone = running ? "text-muted-foreground" : failed ? "text-danger" : "text-success"
            return (
              <li
                key={ev.stage}
                className="flex items-center gap-2 text-xs animate-in fade-in duration-200"
              >
                <Icon
                  className={cn("size-3.5 shrink-0", tone, running && "animate-spin")}
                />
                <span className="w-9 shrink-0 text-[11px] text-muted-foreground">
                  {stageLabel[ev.stage]}
                </span>
                <span
                  className={cn(
                    "truncate",
                    failed ? "text-danger" : running ? "text-foreground/80" : "text-foreground",
                  )}
                >
                  {ev.message}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function ChannelCards() {
  const { data: channels, loading } = useChannels()
  const refresh = useTriggerRefresh()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [editing, setEditing] = useState<Channel | null>(null)
  const [creating, setCreating] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  // 每个渠道当前 sync 进度（最新一条事件） + 历史事件
  const [syncState, setSyncState] = useState<Record<number, ChannelSyncState>>({})

  // 成功后自动消失需要的两段定时器：先 5s 显示，再 500ms 过渡（与 strip 的 transition-opacity duration-500 对齐）。
  const hideTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const timers = hideTimers.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [])

  function clearHideTimer(id: number) {
    const t = hideTimers.current.get(id)
    if (t != null) {
      clearTimeout(t)
      hideTimers.current.delete(id)
    }
  }

  function scheduleHide(id: number) {
    clearHideTimer(id)
    const t1 = setTimeout(() => {
      patchSync(id, (prev) => ({ ...prev, fading: true }))
      const t2 = setTimeout(() => {
        setSyncState((s) => {
          const { [id]: _gone, ...rest } = s
          void _gone
          return rest
        })
        hideTimers.current.delete(id)
      }, 500)
      hideTimers.current.set(id, t2)
    }, 5000)
    hideTimers.current.set(id, t1)
  }

  function patchSync(id: number, fn: (prev: ChannelSyncState) => ChannelSyncState) {
    setSyncState((s) => ({ ...s, [id]: fn(s[id] ?? emptySyncState()) }))
  }

  async function startStream(channel: Channel, action: "sync" | "test-login") {
    clearHideTimer(channel.id)
    patchSync(channel.id, () => ({
      running: true,
      events: [],
      latest: null,
      finalOk: null,
      fading: false,
    }))
    let sawError = false
    const stream = action === "sync" ? syncChannelStream : testLoginStream
    try {
      await stream(channel.id, {
        onEvent: (ev) => {
          if (ev.stage === "error" || ev.ok === false) sawError = true
          patchSync(channel.id, (prev) => ({
            ...prev,
            events: [...prev.events, ev],
            latest: ev,
          }))
        },
      })
      const ok = !sawError
      patchSync(channel.id, (prev) => ({
        ...prev,
        running: false,
        finalOk: ok,
      }))
      if (ok) scheduleHide(channel.id)
    } catch (e) {
      const err = e as Error
      const failureLabel = action === "sync" ? "同步失败" : "测试登录失败"
      patchSync(channel.id, (prev) => ({
        ...prev,
        running: false,
        finalOk: false,
        latest: {
          stage: "error",
          message: err.message || failureLabel,
          time: new Date().toISOString(),
        },
      }))
      // 失败保留，不调度自动隐藏
    } finally {
      refresh()
    }
  }

  async function withBusy(key: string, fn: () => Promise<unknown>) {
    setBusyAction(key)
    try {
      await fn()
      refresh()
    } catch (e) {
      const err = e as Error
      toast.error(err.message || "操作失败")
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-base font-semibold text-foreground">{"渠道"}</h2>
          <p className="text-xs text-muted-foreground">{"实时健康、余额与同步状态"}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {channels?.length ?? 0}{" 个渠道"}
          </span>
          <Button
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => {
              setEditing(null)
              setCreating(true)
            }}
          >
            <Plus className="size-3.5" />
            {"新增"}
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {"加载中…"}
        </p>
      ) : !channels || channels.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">{"还没有任何渠道。"}</p>
          <Button
            size="sm"
            className="mt-3 gap-1.5"
            onClick={() => {
              setEditing(null)
              setCreating(true)
            }}
          >
            <Plus className="size-3.5" />
            {"添加第一个渠道"}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
          {channels.map((c) => {
            const status = statusOf(c)
            const meta = statusMap[status]
            return (
              <Card key={c.id} className="flex flex-col gap-0 border border-border p-4 shadow-none">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{c.name}</span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                      c.type === "newapi"
                        ? "bg-brand/10 text-brand ring-brand/20"
                        : "bg-foreground/5 text-foreground ring-border",
                    )}
                  >
                    {channelTypeLabel(c.type)}
                  </span>
                  {!c.monitor_enabled ? (
                    <span className="inline-flex items-center rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {"已暂停"}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 divide-y divide-border">
                  <Row label="余额">{money(c.last_balance)}</Row>
                  <Row label="阈值">{c.balance_threshold > 0 ? money(c.balance_threshold) : "未设置"}</Row>
                  <Row label="状态">
                    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium", meta.cls)}>
                      {meta.label}
                    </span>
                  </Row>
                  <Row label="上次更新">{relativeTime(c.last_balance_at ?? c.updated_at)}</Row>
                  {c.last_error ? (
                    <div className="py-1">
                      <p className="break-all text-[11px] text-danger" title={c.last_error}>
                        {c.last_error.length > 80 ? c.last_error.slice(0, 80) + "…" : c.last_error}
                      </p>
                    </div>
                  ) : null}
                </div>

                <InlineRates channelID={c.id} />

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs"
                    disabled={!!syncState[c.id]?.running}
                    onClick={() => startStream(c, "sync")}
                  >
                    <RefreshCw
                      className={cn("size-3", syncState[c.id]?.running && "animate-spin")}
                    />
                    {"同步"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs"
                    disabled={!!syncState[c.id]?.running}
                    onClick={() => startStream(c, "test-login")}
                  >
                    <LogIn className="size-3" />
                    {"测试登录"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-xs"
                    onClick={() => {
                      setEditing(c)
                      setCreating(true)
                    }}
                  >
                    <Pencil className="size-3" />
                    {"编辑"}
                  </Button>
                </div>

                <SyncProgressStrip state={syncState[c.id] ?? emptySyncState()} />

                <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs text-muted-foreground"
                    disabled={busyAction === `toggle-${c.id}`}
                    onClick={() =>
                      withBusy(`toggle-${c.id}`, () =>
                        apiFetch(`/channels/${c.id}/${c.monitor_enabled ? "disable" : "enable"}`, {
                          method: "POST",
                        }),
                      )
                    }
                  >
                    {c.monitor_enabled ? (
                      <Pause className="size-3" />
                    ) : (
                      <Play className="size-3" />
                    )}
                    {c.monitor_enabled ? "暂停监控" : "恢复监控"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busyAction === `delete-${c.id}`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `删除渠道 ${c.name}？`,
                        description: "删除后该渠道的余额历史、倍率快照与登录凭据都将一并清除，且无法恢复。",
                        confirmLabel: "删除",
                        destructive: true,
                      })
                      if (!ok) return
                      void withBusy(`delete-${c.id}`, () =>
                        apiFetch(`/channels/${c.id}`, { method: "DELETE" }),
                      )
                    }}
                  >
                    <Trash2 className="size-3" />
                    {"删除"}
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <ChannelFormDialog
        open={creating}
        onOpenChange={(v) => {
          setCreating(v)
          if (!v) setEditing(null)
        }}
        channel={editing}
      />

      {confirmDialog}
    </section>
  )
}
