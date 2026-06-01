"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowUpRight,
  KeyRound,
  Pencil,
  Plus,
  Send,
  ShieldX,
  TestTube2,
  Trash2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { useCaptchaConfigs, useDashboardSummary, useNotificationChannels } from "@/lib/queries"
import { apiFetch } from "@/lib/api"
import { useTriggerRefresh } from "@/lib/refresh-context"
import { relativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { CaptchaFormDialog } from "@/components/monitor/captcha-form-dialog"
import { NotificationFormDialog } from "@/components/monitor/notification-form-dialog"
import type { LucideIcon } from "lucide-react"
import type {
  CaptchaConfig,
  NotificationChannel,
  NotificationEvent,
  NotificationChannelType,
} from "@/lib/api-types"

const eventMeta: Record<NotificationEvent, { icon: LucideIcon; cls: string }> = {
  balance_low: { icon: AlertTriangle, cls: "text-warning" },
  login_failed: { icon: ShieldX, cls: "text-danger" },
  captcha_failed: { icon: KeyRound, cls: "text-danger" },
  rate_changed: { icon: ArrowUpRight, cls: "text-brand" },
  monitor_failed: { icon: ShieldX, cls: "text-danger" },
}

export function AlertFeed() {
  const summary = useDashboardSummary()
  const items = summary.data?.recent_notification_logs ?? []

  return (
    <Card className="border border-border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold">{"告警动态"}</CardTitle>
        <span className="text-xs text-muted-foreground">{items.length > 0 ? `最近 ${items.length} 条` : ""}</span>
      </CardHeader>
      <CardContent className="px-0">
        {summary.loading ? (
          <p className="px-6 py-4 text-xs text-muted-foreground">{"加载中…"}</p>
        ) : items.length === 0 ? (
          <p className="px-6 py-4 text-xs text-muted-foreground">{"暂无告警记录"}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((a) => {
              const meta = eventMeta[a.event] ?? { icon: AlertTriangle, cls: "text-muted-foreground" }
              return (
                <li key={a.id} className="flex items-center justify-between gap-3 px-6 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <meta.icon className={cn("size-4 shrink-0", meta.cls)} />
                    <span className="truncate text-sm text-foreground">{a.subject}</span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(a.sent_at)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

const captchaTypeLabel: Record<string, string> = {
  capsolver: "CapSolver",
  "2captcha": "2Captcha",
  anticaptcha: "AntiCaptcha",
  custom: "自定义",
}

export function CaptchaStatus() {
  const { data, loading } = useCaptchaConfigs()
  const refresh = useTriggerRefresh()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [editing, setEditing] = useState<CaptchaConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)

  async function handleDelete(c: CaptchaConfig) {
    const ok = await confirm({
      title: `删除打码配置 ${c.name}？`,
      description: "删除后引用此配置的渠道将无法自动过码，需要重新指定打码 provider。",
      confirmLabel: "删除",
      destructive: true,
    })
    if (!ok) return
    setBusy(c.id)
    try {
      await apiFetch(`/captcha-configs/${c.id}`, { method: "DELETE" })
      toast.success(`已删除 ${c.name}`)
      refresh()
    } catch (e) {
      const err = e as Error
      toast.error(err.message || "删除失败")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="border border-border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold">{"验证码服务"}</CardTitle>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
        >
          <Plus className="size-3" />
          {"新增"}
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        {loading ? (
          <p className="px-6 py-4 text-xs text-muted-foreground">{"加载中…"}</p>
        ) : !data || data.length === 0 ? (
          <p className="px-6 py-4 text-xs text-muted-foreground">{"暂未配置打码 provider"}</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-6 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      p.enabled ? "bg-success" : "bg-muted-foreground/30",
                    )}
                  />
                  <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {captchaTypeLabel[p.type] ?? p.type}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span
                    className={cn(
                      "mr-1 text-xs",
                      p.enabled ? "text-success" : "text-muted-foreground",
                    )}
                  >
                    {p.enabled ? "已启用" : "已禁用"}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => {
                      setEditing(p)
                      setOpen(true)
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy === p.id}
                    onClick={() => handleDelete(p)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <CaptchaFormDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) setEditing(null)
        }}
        config={editing}
      />

      {confirmDialog}
    </Card>
  )
}

const notifyTypeIcon: Partial<Record<NotificationChannelType, LucideIcon>> = {
  telegram: Send,
  webhook: Send,
  email: Send,
  wecom: Send,
  dingtalk: Send,
  feishu: Send,
}

export function NotificationStatus() {
  const { data, loading } = useNotificationChannels()
  const summary = useDashboardSummary()
  const refresh = useTriggerRefresh()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [editing, setEditing] = useState<NotificationChannel | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)

  const totalLogs = summary.data?.recent_notification_logs ?? []
  const lastSent = totalLogs.length > 0 ? totalLogs[0] : null
  const recentFailed = totalLogs.filter((l) => !l.success).length

  async function handleDelete(c: NotificationChannel) {
    const ok = await confirm({
      title: `删除通知渠道 ${c.name}？`,
      description: "删除后系统将不再向该渠道推送告警，历史发送记录会保留以便审计。",
      confirmLabel: "删除",
      destructive: true,
    })
    if (!ok) return
    setBusy(c.id)
    try {
      await apiFetch(`/notifications/channels/${c.id}`, { method: "DELETE" })
      toast.success(`已删除 ${c.name}`)
      refresh()
    } catch (e) {
      const err = e as Error
      toast.error(err.message || "删除失败")
    } finally {
      setBusy(null)
    }
  }

  async function handleTest(c: NotificationChannel) {
    setBusy(c.id)
    try {
      const res = await apiFetch<{ ok: boolean; error?: string }>(
        `/notifications/channels/${c.id}/test`,
        { method: "POST" },
      )
      if (res.ok) {
        toast.success(`已发送测试消息到 ${c.name}`)
      } else {
        toast.error(`测试失败：${res.error ?? "未知错误"}`)
      }
      refresh()
    } catch (e) {
      const err = e as Error
      toast.error(err.message || "测试失败")
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="border border-border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold">{"通知渠道"}</CardTitle>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
        >
          <Plus className="size-3" />
          {"新增"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-xs text-muted-foreground">{"加载中…"}</p>
        ) : !data || data.length === 0 ? (
          <p className="text-xs text-muted-foreground">{"暂未配置通知渠道"}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.map((c) => {
              const Icon = notifyTypeIcon[c.type] ?? Send
              const subCount = parseSubCount(c.subscriptions)
              return (
                <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Icon className={cn("size-4 shrink-0", c.enabled ? "text-brand" : "text-muted-foreground")} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {c.type}
                        {" · "}
                        {subCount === 0 ? "订阅全部" : `${subCount} 条订阅`}
                        {!c.enabled ? " · 已禁用" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="测试发送"
                      disabled={busy === c.id}
                      onClick={() => handleTest(c)}
                    >
                      <TestTube2 className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="编辑"
                      onClick={() => {
                        setEditing(c)
                        setOpen(true)
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      title="删除"
                      disabled={busy === c.id}
                      onClick={() => handleDelete(c)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <div className="divide-y divide-border rounded-lg border border-border">
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-xs text-muted-foreground">{"上次发送"}</span>
            <span className="text-xs font-medium text-foreground">
              {lastSent ? relativeTime(lastSent.sent_at) : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-xs text-muted-foreground">{"近 10 条失败"}</span>
            <span
              className={cn(
                "text-xs font-semibold",
                recentFailed === 0 ? "text-success" : "text-danger",
              )}
            >
              {recentFailed}
            </span>
          </div>
        </div>
      </CardContent>

      <NotificationFormDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) setEditing(null)
        }}
        channel={editing}
      />

      {confirmDialog}
    </Card>
  )
}

function parseSubCount(raw?: string): number {
  if (!raw) return 0
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.length : 0
  } catch {
    return 0
  }
}

export function BottomPanels() {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <AlertFeed />
      <CaptchaStatus />
      <NotificationStatus />
    </div>
  )
}
