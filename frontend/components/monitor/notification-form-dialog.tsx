"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Plus, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { apiFetch } from "@/lib/api"
import { useTriggerRefresh } from "@/lib/refresh-context"
import { useChannels, useChannelRates } from "@/lib/queries"
import type {
  NotificationChannel,
  NotificationChannelType,
  NotificationSubscription,
} from "@/lib/api-types"

interface NotificationFormDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  channel?: NotificationChannel | null
}

interface ConfigState {
  // telegram
  bot_token: string
  chat_id: string
  // webhook
  url: string
  method: string
  headers: string // 原始 JSON 字符串，留空 = 不传
  // email
  host: string
  port: string
  username: string
  password: string
  from: string
  to: string // 逗号分隔
  use_tls: boolean
  // wecom / dingtalk / feishu
  webhook_url: string
  secret: string
}

interface SubRow {
  channel_id: number | null
  mode: "all" | "groups"
  groups: string[]
}

interface FormState {
  name: string
  type: NotificationChannelType
  enabled: boolean
  cfg: ConfigState
  subs: SubRow[]
}

function emptyConfig(): ConfigState {
  return {
    bot_token: "",
    chat_id: "",
    url: "",
    method: "POST",
    headers: "",
    host: "",
    port: "",
    username: "",
    password: "",
    from: "",
    to: "",
    use_tls: false,
    webhook_url: "",
    secret: "",
  }
}

function initialState(c?: NotificationChannel | null): FormState {
  let subs: SubRow[] = []
  if (c?.subscriptions) {
    try {
      const parsed = JSON.parse(c.subscriptions) as NotificationSubscription[]
      subs = parsed.map((s) => ({
        channel_id: s.channel_id,
        mode: s.mode,
        groups: s.groups ?? [],
      }))
    } catch {
      subs = []
    }
  }
  return {
    name: c?.name ?? "",
    type: c?.type ?? "telegram",
    enabled: c?.enabled ?? true,
    cfg: emptyConfig(),
    subs,
  }
}

// buildConfigByType 把 cfg state 序列化成各 notifier 期望的 JSON。
// 留空字段会被剔除（除非该字段是必填）。
function buildConfigByType(type: NotificationChannelType, cfg: ConfigState): string {
  switch (type) {
    case "telegram":
      return JSON.stringify({
        bot_token: cfg.bot_token,
        chat_id: cfg.chat_id,
      })
    case "webhook": {
      const body: Record<string, unknown> = { url: cfg.url }
      if (cfg.method && cfg.method !== "POST") body.method = cfg.method
      if (cfg.headers.trim()) {
        // 验证是合法 JSON object；不是就抛错让用户改
        const parsed = JSON.parse(cfg.headers)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          body.headers = parsed
        } else {
          throw new Error("headers 必须是 JSON 对象，例如 {\"Authorization\":\"Bearer ...\"}")
        }
      }
      return JSON.stringify(body)
    }
    case "email": {
      const port = Number(cfg.port)
      if (!Number.isFinite(port) || port <= 0) throw new Error("端口必须是正整数")
      const to = cfg.to.split(",").map((s) => s.trim()).filter(Boolean)
      if (to.length === 0) throw new Error("收件人至少一个")
      return JSON.stringify({
        host: cfg.host,
        port,
        username: cfg.username,
        password: cfg.password,
        from: cfg.from,
        to,
        use_tls: cfg.use_tls,
      })
    }
    case "wecom":
      return JSON.stringify({ webhook_url: cfg.webhook_url })
    case "dingtalk":
    case "feishu": {
      const body: Record<string, unknown> = { webhook_url: cfg.webhook_url }
      if (cfg.secret) body.secret = cfg.secret
      return JSON.stringify(body)
    }
  }
}

export function NotificationFormDialog({
  open,
  onOpenChange,
  channel,
}: NotificationFormDialogProps) {
  const [form, setForm] = useState<FormState>(() => initialState(channel))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useTriggerRefresh()
  const channels = useChannels()

  useEffect(() => {
    if (open) {
      setForm(initialState(channel))
      setError(null)
    }
  }, [open, channel])

  const isEdit = !!channel

  function updateCfg(patch: Partial<ConfigState>) {
    setForm((f) => ({ ...f, cfg: { ...f.cfg, ...patch } }))
  }

  function addSub() {
    setForm((f) => ({
      ...f,
      subs: [...f.subs, { channel_id: null, mode: "all", groups: [] }],
    }))
  }

  function updateSub(idx: number, patch: Partial<SubRow>) {
    setForm((f) => {
      const next = f.subs.slice()
      next[idx] = { ...next[idx], ...patch }
      return { ...f, subs: next }
    })
  }

  function removeSub(idx: number) {
    setForm((f) => ({ ...f, subs: f.subs.filter((_, i) => i !== idx) }))
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      // 校验订阅：未选上游的行禁止保存
      for (const s of form.subs) {
        if (s.channel_id == null) {
          throw new Error("订阅列表里有未选择的上游，请补全或删除")
        }
      }

      let configJSON = ""
      const requireConfig = !isEdit
      // 判断 cfg 是否填了关键字段
      const hasConfigInput = (() => {
        switch (form.type) {
          case "telegram":
            return !!(form.cfg.bot_token || form.cfg.chat_id)
          case "webhook":
            return !!form.cfg.url
          case "email":
            return !!(form.cfg.host || form.cfg.from || form.cfg.to)
          default:
            return !!form.cfg.webhook_url
        }
      })()

      if (requireConfig || hasConfigInput) {
        configJSON = buildConfigByType(form.type, form.cfg)
      }

      const subscriptions = JSON.stringify(
        form.subs.map((s) => ({
          channel_id: s.channel_id as number,
          mode: s.mode,
          groups: s.mode === "groups" ? s.groups : [],
        })),
      )

      const body: Record<string, unknown> = {
        name: form.name,
        type: form.type,
        enabled: form.enabled,
        subscriptions,
      }
      if (configJSON) body.config = configJSON

      if (isEdit) {
        await apiFetch(`/notifications/channels/${channel!.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        })
      } else {
        await apiFetch(`/notifications/channels`, {
          method: "POST",
          body: JSON.stringify(body),
        })
      }
      onOpenChange(false)
      refresh()
    } catch (e) {
      const err = e as Error
      setError(err.message || "保存失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑通知渠道" : "新增通知渠道"}</DialogTitle>
          <DialogDescription>
            订阅留空表示接收所有上游的所有事件（向后兼容）。配置好订阅后只会收到关心的事件。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="notify-name">渠道名</Label>
            <Input
              id="notify-name"
              placeholder="例如：TG-运维群"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notify-type">类型</Label>
            <Select
              value={form.type}
              onValueChange={(v) =>
                setForm({ ...form, type: v as NotificationChannelType, cfg: emptyConfig() })
              }
              disabled={isEdit || submitting}
            >
              <SelectTrigger id="notify-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="telegram">Telegram</SelectItem>
                <SelectItem value="webhook">Webhook</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="wecom">企业微信</SelectItem>
                <SelectItem value="dingtalk">钉钉</SelectItem>
                <SelectItem value="feishu">飞书</SelectItem>
              </SelectContent>
            </Select>
            {isEdit ? (
              <p className="text-[11px] text-muted-foreground">类型创建后不可修改</p>
            ) : null}
          </div>

          <ConfigFields
            type={form.type}
            cfg={form.cfg}
            updateCfg={updateCfg}
            disabled={submitting}
            isEdit={isEdit}
          />

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium">启用</p>
              <p className="text-xs text-muted-foreground">关闭后调度器不会向此渠道推送</p>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm({ ...form, enabled: v })}
              disabled={submitting}
            />
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">订阅规则</p>
                <p className="text-[11px] text-muted-foreground">
                  留空 = 收到所有上游的所有事件；添加规则后只收命中的
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={addSub}
                disabled={submitting}
              >
                <Plus className="size-3" />
                添加
              </Button>
            </div>

            {form.subs.length === 0 ? (
              <p className="rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                暂无订阅，所有事件都会收到
              </p>
            ) : (
              <div className="space-y-2">
                {form.subs.map((row, idx) => (
                  <SubRowEditor
                    key={idx}
                    row={row}
                    channels={(channels.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
                    onChange={(patch) => updateSub(idx, patch)}
                    onRemove={() => removeSub(idx)}
                    disabled={submitting}
                  />
                ))}
              </div>
            )}
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface ConfigFieldsProps {
  type: NotificationChannelType
  cfg: ConfigState
  updateCfg: (patch: Partial<ConfigState>) => void
  disabled: boolean
  isEdit: boolean
}

function ConfigFields({ type, cfg, updateCfg, disabled, isEdit }: ConfigFieldsProps) {
  const hint = isEdit ? (
    <p className="text-[11px] text-muted-foreground">编辑模式下留空保留原值</p>
  ) : null

  if (type === "telegram") {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-xs font-medium text-muted-foreground">Telegram</p>
        <div className="space-y-1.5">
          <Label htmlFor="tg-token">Bot Token</Label>
          <Input
            id="tg-token"
            type="password"
            placeholder="123456:ABC-..."
            value={cfg.bot_token}
            onChange={(e) => updateCfg({ bot_token: e.target.value })}
            required={!isEdit}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tg-chat">Chat ID</Label>
          <Input
            id="tg-chat"
            placeholder="-1001234567890 或 @channelname"
            value={cfg.chat_id}
            onChange={(e) => updateCfg({ chat_id: e.target.value })}
            required={!isEdit}
            disabled={disabled}
          />
        </div>
        {hint}
      </div>
    )
  }

  if (type === "webhook") {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-xs font-medium text-muted-foreground">Webhook</p>
        <div className="space-y-1.5">
          <Label htmlFor="wh-url">URL</Label>
          <Input
            id="wh-url"
            placeholder="https://example.com/hook"
            value={cfg.url}
            onChange={(e) => updateCfg({ url: e.target.value })}
            required={!isEdit}
            disabled={disabled}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="wh-method">Method</Label>
            <Select
              value={cfg.method || "POST"}
              onValueChange={(v) => updateCfg({ method: v })}
              disabled={disabled}
            >
              <SelectTrigger id="wh-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="GET">GET</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="wh-headers">Headers (JSON, 可选)</Label>
            <Input
              id="wh-headers"
              placeholder='{"Authorization":"Bearer xxx"}'
              value={cfg.headers}
              onChange={(e) => updateCfg({ headers: e.target.value })}
              disabled={disabled}
            />
          </div>
        </div>
        {hint}
      </div>
    )
  }

  if (type === "email") {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-xs font-medium text-muted-foreground">Email (SMTP)</p>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="em-host">Host</Label>
            <Input
              id="em-host"
              placeholder="smtp.example.com"
              value={cfg.host}
              onChange={(e) => updateCfg({ host: e.target.value })}
              required={!isEdit}
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="em-port">Port</Label>
            <Input
              id="em-port"
              type="number"
              placeholder="465"
              value={cfg.port}
              onChange={(e) => updateCfg({ port: e.target.value })}
              required={!isEdit}
              disabled={disabled}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="em-user">Username</Label>
            <Input
              id="em-user"
              value={cfg.username}
              onChange={(e) => updateCfg({ username: e.target.value })}
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="em-pass">Password</Label>
            <Input
              id="em-pass"
              type="password"
              value={cfg.password}
              onChange={(e) => updateCfg({ password: e.target.value })}
              disabled={disabled}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="em-from">From</Label>
          <Input
            id="em-from"
            placeholder="alert@example.com"
            value={cfg.from}
            onChange={(e) => updateCfg({ from: e.target.value })}
            required={!isEdit}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="em-to">To (逗号分隔多个)</Label>
          <Input
            id="em-to"
            placeholder="a@x.com, b@x.com"
            value={cfg.to}
            onChange={(e) => updateCfg({ to: e.target.value })}
            required={!isEdit}
            disabled={disabled}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="em-tls" className="text-sm font-normal">
            隐式 TLS (一般 465 端口开启)
          </Label>
          <Switch
            id="em-tls"
            checked={cfg.use_tls}
            onCheckedChange={(v) => updateCfg({ use_tls: v })}
            disabled={disabled}
          />
        </div>
        {hint}
      </div>
    )
  }

  // wecom / dingtalk / feishu
  const supportsSecret = type === "dingtalk" || type === "feishu"
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">
        {type === "wecom" ? "企业微信" : type === "dingtalk" ? "钉钉" : "飞书"}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="wb-url">Webhook URL</Label>
        <Input
          id="wb-url"
          value={cfg.webhook_url}
          onChange={(e) => updateCfg({ webhook_url: e.target.value })}
          required={!isEdit}
          disabled={disabled}
        />
      </div>
      {supportsSecret ? (
        <div className="space-y-1.5">
          <Label htmlFor="wb-secret">Secret (可选, HMAC 签名)</Label>
          <Input
            id="wb-secret"
            type="password"
            value={cfg.secret}
            onChange={(e) => updateCfg({ secret: e.target.value })}
            disabled={disabled}
          />
        </div>
      ) : null}
      {hint}
    </div>
  )
}

interface SubRowEditorProps {
  row: SubRow
  channels: Array<{ id: number; name: string }>
  onChange: (patch: Partial<SubRow>) => void
  onRemove: () => void
  disabled: boolean
}

function SubRowEditor({ row, channels, onChange, onRemove, disabled }: SubRowEditorProps) {
  // 只有真正展开 "指定分组" 时才拉 rates，避免每行都打一次接口
  const enableRateFetch = row.channel_id != null && row.mode === "groups"
  const rates = useChannelRates(enableRateFetch ? row.channel_id : null)

  const groupNames = useMemo(() => {
    const set = new Set<string>()
    for (const r of rates.data ?? []) set.add(r.model_name)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [rates.data])

  function toggleGroup(name: string, checked: boolean) {
    const next = checked
      ? Array.from(new Set([...row.groups, name]))
      : row.groups.filter((g) => g !== name)
    onChange({ groups: next })
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-2.5">
      <div className="flex items-center gap-2">
        <Select
          value={row.channel_id != null ? String(row.channel_id) : ""}
          onValueChange={(v) => onChange({ channel_id: Number(v), groups: [] })}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue placeholder="选择渠道" />
          </SelectTrigger>
          <SelectContent>
            {channels.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
          disabled={disabled}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <RadioGroup
        value={row.mode}
        onValueChange={(v) => onChange({ mode: v as "all" | "groups", groups: [] })}
        className="flex gap-4"
        disabled={disabled}
      >
        <div className="flex items-center gap-1.5">
          <RadioGroupItem value="all" id={`mode-all-${row.channel_id ?? "x"}`} />
          <Label
            htmlFor={`mode-all-${row.channel_id ?? "x"}`}
            className="text-xs font-normal"
          >
            全部事件 / 所有分组
          </Label>
        </div>
        <div className="flex items-center gap-1.5">
          <RadioGroupItem value="groups" id={`mode-grp-${row.channel_id ?? "x"}`} />
          <Label
            htmlFor={`mode-grp-${row.channel_id ?? "x"}`}
            className="text-xs font-normal"
          >
            仅指定分组的倍率变化
          </Label>
        </div>
      </RadioGroup>

      {row.mode === "groups" ? (
        <div className="space-y-1.5">
          {row.channel_id == null ? (
            <p className="text-[11px] text-muted-foreground">请先选择上游</p>
          ) : rates.loading ? (
            <p className="text-[11px] text-muted-foreground">加载分组…</p>
          ) : groupNames.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              该上游暂未采集到分组数据，先去渠道页"手动刷新倍率"
            </p>
          ) : (
            <ScrollArea className="max-h-32 rounded border border-border bg-muted/30 p-2">
              <div className="grid grid-cols-2 gap-1.5">
                {groupNames.map((name) => {
                  const id = `grp-${row.channel_id}-${name}`
                  const checked = row.groups.includes(name)
                  return (
                    <label
                      key={name}
                      htmlFor={id}
                      className="flex cursor-pointer items-center gap-1.5 text-xs"
                    >
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(v) => toggleGroup(name, !!v)}
                        disabled={disabled}
                      />
                      <span className="truncate">{name}</span>
                    </label>
                  )
                })}
              </div>
            </ScrollArea>
          )}
          {row.mode === "groups" && row.groups.length === 0 && row.channel_id != null ? (
            <p className="text-[11px] text-warning">未勾选任何分组 — 该订阅不会命中任何事件</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
