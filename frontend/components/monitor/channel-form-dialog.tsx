"use client"

import { useEffect, useState, type FormEvent } from "react"
import { HelpCircle } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { Channel, ChannelType, CredentialMode } from "@/lib/api-types"
import { apiFetch } from "@/lib/api"
import { useTriggerRefresh } from "@/lib/refresh-context"
import { useCaptchaConfigs } from "@/lib/queries"
import { cn } from "@/lib/utils"

interface ChannelFormDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** 编辑模式时传入；为空表示新增 */
  channel?: Channel | null
}

/**
 * FormState 是表单的所有可编辑字段。
 *
 * password 字段在 token 模式下不展示；
 * token 字段（cookie / user_id / access_token）在 password 模式下不展示。
 * 这些状态对应保留在内存里，方便用户来回切换不丢失输入。
 */
interface FormState {
  name: string
  type: ChannelType
  site_url: string
  username: string
  password: string

  credential_mode: CredentialMode
  // NewAPI token 模式
  newapi_cookie: string
  newapi_user_id: string
  // Sub2API token 模式
  sub2api_access_token: string

  balance_threshold: string
  monitor_enabled: boolean
  turnstile_enabled: boolean
  captcha_config_id: string // "" 表示不绑定
}

function initialState(c?: Channel | null): FormState {
  return {
    name: c?.name ?? "",
    type: c?.type ?? "newapi",
    site_url: c?.site_url ?? "",
    username: c?.username ?? "",
    password: "",
    credential_mode: c?.credential_mode ?? "password",
    newapi_cookie: "",
    newapi_user_id: "",
    sub2api_access_token: "",
    balance_threshold: c?.balance_threshold != null ? String(c.balance_threshold) : "0",
    monitor_enabled: c?.monitor_enabled ?? true,
    turnstile_enabled: c?.turnstile_enabled ?? false,
    captcha_config_id: c?.captcha_config_id != null ? String(c.captcha_config_id) : "",
  }
}

/**
 * buildTokenCredential 把当前表单里的 token 字段序列化成后端期望的 JSON 字符串。
 * 字段命名与 channel/service.go 里的 NewAPITokenCredential / Sub2APITokenCredential 对齐。
 */
function buildTokenCredential(form: FormState): string {
  if (form.type === "newapi") {
    return JSON.stringify({
      cookie: form.newapi_cookie.trim(),
      user_id: form.newapi_user_id.trim(),
    })
  }
  return JSON.stringify({
    access_token: form.sub2api_access_token.trim(),
  })
}

export function ChannelFormDialog({ open, onOpenChange, channel }: ChannelFormDialogProps) {
  const [form, setForm] = useState<FormState>(() => initialState(channel))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useTriggerRefresh()
  const captchas = useCaptchaConfigs()

  // 打开 / 切换目标渠道时重置表单。
  useEffect(() => {
    if (open) {
      setForm(initialState(channel))
      setError(null)
    }
  }, [open, channel])

  const isEdit = !!channel
  const isTokenMode = form.credential_mode === "token"
  // 编辑模式下，若 credential_mode 没变，token / password 都可以留空表示不修改。
  const modeChanged = isEdit && form.credential_mode !== (channel?.credential_mode ?? "password")

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const threshold = Number(form.balance_threshold)
      if (!Number.isFinite(threshold) || threshold < 0) {
        throw new Error("余额阈值必须是非负数")
      }

      // token 模式：用户填的字段对应不同 connector 的 token JSON
      let tokenCredential = ""
      if (isTokenMode) {
        if (form.type === "newapi") {
          if (!isEdit || modeChanged || form.newapi_cookie || form.newapi_user_id) {
            if (!form.newapi_cookie.trim()) throw new Error("NewAPI token 模式必须填写 Cookie")
            if (!form.newapi_user_id.trim()) throw new Error("NewAPI token 模式必须填写 User ID")
          }
        } else {
          if (!isEdit || modeChanged || form.sub2api_access_token) {
            if (!form.sub2api_access_token.trim())
              throw new Error("Sub2API token 模式必须填写 Access Token")
          }
        }
        // 只在用户填写了字段、或者首次创建、或者切换模式时下发 token_credential
        if (
          !isEdit ||
          modeChanged ||
          form.newapi_cookie ||
          form.newapi_user_id ||
          form.sub2api_access_token
        ) {
          tokenCredential = buildTokenCredential(form)
        }
      }

      // 打码 provider 只在 password 模式 + 启用 Turnstile 时生效
      const useCaptcha = !isTokenMode && form.turnstile_enabled
      const captchaConfigID =
        useCaptcha && form.captcha_config_id ? Number(form.captcha_config_id) : null
      if (useCaptcha && captchaConfigID == null) {
        throw new Error("启用 Turnstile 时必须选择一个打码 provider")
      }

      // password 模式下的密码校验
      if (!isTokenMode) {
        if (!isEdit && !form.password) throw new Error("新建时必须填写密码")
        if (modeChanged && !form.password) throw new Error("切换到账号密码模式时必须填写密码")
      }

      if (isEdit) {
        const body: Record<string, unknown> = {
          name: form.name,
          site_url: form.site_url,
          username: form.username,
          credential_mode: form.credential_mode,
          balance_threshold: threshold,
          monitor_enabled: form.monitor_enabled,
          turnstile_enabled: !isTokenMode && form.turnstile_enabled,
          captcha_config_id: captchaConfigID,
        }
        if (!isTokenMode && form.password) body.password = form.password
        if (isTokenMode && tokenCredential) body.token_credential = tokenCredential
        await apiFetch(`/channels/${channel!.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        })
      } else {
        await apiFetch(`/channels`, {
          method: "POST",
          body: JSON.stringify({
            name: form.name,
            type: form.type,
            site_url: form.site_url,
            username: form.username,
            credential_mode: form.credential_mode,
            password: isTokenMode ? "" : form.password,
            token_credential: isTokenMode ? tokenCredential : "",
            balance_threshold: threshold,
            monitor_enabled: form.monitor_enabled,
            turnstile_enabled: !isTokenMode && form.turnstile_enabled,
            captcha_config_id: captchaConfigID,
          }),
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
      <DialogContent className="max-h-[90vh] min-w-0 overflow-x-hidden overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑渠道" : "新增渠道"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "修改后会清空已缓存的登录会话。" : "添加上游账号，开启监控后将按计划自动登录。"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="min-w-0 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">渠道名</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="type">类型</Label>
            <Select
              value={form.type}
              onValueChange={(v) => setForm({ ...form, type: v as ChannelType })}
              disabled={isEdit || submitting}
            >
              <SelectTrigger id="type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newapi">NewAPI</SelectItem>
                <SelectItem value="sub2api">Sub2API</SelectItem>
              </SelectContent>
            </Select>
            {isEdit ? (
              <p className="text-[11px] text-muted-foreground">类型创建后不可修改</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="site_url">站点地址</Label>
            <Input
              id="site_url"
              placeholder="https://example.com"
              value={form.site_url}
              onChange={(e) => setForm({ ...form, site_url: e.target.value })}
              required
              disabled={submitting}
            />
          </div>

          {/* 凭据类型 toggle */}
          <div className="space-y-1.5">
            <Label>凭据类型</Label>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-border p-1">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setForm({ ...form, credential_mode: "password" })}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  !isTokenMode
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                账号密码
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setForm({ ...form, credential_mode: "token" })}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  isTokenMode
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                Token (跳过登录)
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {isTokenMode
                ? "粘贴浏览器里已登录后的 Token / Cookie。失效时需要手动重新粘贴。"
                : "提供账号密码，系统自动登录并续期。可能需要配打码 provider。"}
            </p>
          </div>

          {/* —— password 模式字段 —— */}
          {!isTokenMode ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="username">账号 / 邮箱</Label>
                  <Input
                    id="username"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    required
                    disabled={submitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">
                    {isEdit ? "新密码 (留空不变)" : "密码"}
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required={!isEdit || modeChanged}
                    disabled={submitting}
                  />
                </div>
              </div>
            </>
          ) : null}

          {/* —— token 模式字段 —— */}
          {isTokenMode ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="username-display">备注（可选）</Label>
                <Input
                  id="username-display"
                  placeholder="如：worry@example.com"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  disabled={submitting}
                />
                <p className="text-[11px] text-muted-foreground">
                  仅作展示，不参与鉴权
                </p>
              </div>

              {form.type === "newapi" ? (
                <>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="newapi-cookie">Cookie</Label>
                      <NewAPITokenHelp />
                    </div>
                    <Textarea
                      id="newapi-cookie"
                      placeholder={
                        isEdit
                          ? "留空 = 不修改；填写则覆盖原 token"
                          : "粘贴整段 Cookie 字符串，例：session=...; ..."
                      }
                      value={form.newapi_cookie}
                      onChange={(e) => setForm({ ...form, newapi_cookie: e.target.value })}
                      rows={3}
                      className="field-sizing-fixed min-w-0 max-w-full resize-y text-xs font-mono"
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="newapi-user-id">User ID</Label>
                    <Input
                      id="newapi-user-id"
                      placeholder={
                        isEdit
                          ? "留空 = 不修改；NewAPI 个人设置页可见"
                          : "整数，NewAPI 个人设置页可见"
                      }
                      value={form.newapi_user_id}
                      onChange={(e) => setForm({ ...form, newapi_user_id: e.target.value })}
                      disabled={submitting}
                    />
                  </div>
                </>
              ) : null}

              {form.type === "sub2api" ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="sub2api-token">Access Token</Label>
                    <Sub2APITokenHelp />
                  </div>
                  <Textarea
                    id="sub2api-token"
                    placeholder={
                      isEdit
                        ? "留空 = 不修改；填写则覆盖原 token"
                        : "粘贴 access_token"
                    }
                    value={form.sub2api_access_token}
                    onChange={(e) =>
                      setForm({ ...form, sub2api_access_token: e.target.value })
                    }
                    rows={3}
                    className="field-sizing-fixed min-w-0 max-w-full resize-y text-xs font-mono"
                    disabled={submitting}
                  />
                </div>
              ) : null}
            </>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="threshold">余额阈值（低于此值发告警，0 = 不告警）</Label>
            <Input
              id="threshold"
              type="number"
              step="0.01"
              min="0"
              value={form.balance_threshold}
              onChange={(e) => setForm({ ...form, balance_threshold: e.target.value })}
              disabled={submitting}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div>
              <p className="text-sm font-medium">启用监控</p>
              <p className="text-xs text-muted-foreground">关闭后调度器不会扫描此渠道</p>
            </div>
            <Switch
              checked={form.monitor_enabled}
              onCheckedChange={(v) => setForm({ ...form, monitor_enabled: v })}
              disabled={submitting}
            />
          </div>

          {/* Turnstile / 打码：token 模式下整段不展示 */}
          {!isTokenMode ? (
            <>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Turnstile 人机校验</p>
                  <p className="text-xs text-muted-foreground">站点开启 Cloudflare Turnstile 时打开</p>
                </div>
                <Switch
                  checked={form.turnstile_enabled}
                  onCheckedChange={(v) => setForm({ ...form, turnstile_enabled: v })}
                  disabled={submitting}
                />
              </div>

              {form.turnstile_enabled ? (
                <div className="space-y-1.5">
                  <Label htmlFor="captcha-config">打码 provider</Label>
                  <Select
                    value={form.captcha_config_id}
                    onValueChange={(v) => setForm({ ...form, captcha_config_id: v })}
                    disabled={submitting}
                  >
                    <SelectTrigger id="captcha-config" className="w-full">
                      <SelectValue
                        placeholder={
                          captchas.data && captchas.data.length > 0
                            ? "选择 provider"
                            : "先到底部 [验证码服务] 卡片新增"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(captchas.data ?? [])
                        .filter((c) => c.enabled)
                        .map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    {"siteKey 会自动从上游公开接口拉取，无需在此填写。"}
                  </p>
                </div>
              ) : null}
            </>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
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

/**
 * NewAPITokenHelp 是 Cookie / User ID 的获取指引浮窗。
 * 用 Popover 而不是新页面 / 新对话框，避免在表单流程中打断用户。
 */
function NewAPITokenHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <HelpCircle className="size-3" />
          如何获取？
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-xs" align="end">
        <p className="font-medium text-foreground">获取 Cookie</p>
        <ol className="mt-1 ml-4 list-decimal space-y-0.5 text-muted-foreground">
          <li>在浏览器登录 NewAPI 站点</li>
          <li>按 F12 打开 DevTools，切到 Application / 存储 标签</li>
          <li>左侧 Cookies 选中站点域名</li>
          <li>复制 <span className="font-mono text-foreground">session</span> 字段值，格式：<span className="font-mono">session=xxxxx</span></li>
        </ol>
        <p className="mt-2 font-medium text-foreground">获取 User ID</p>
        <p className="mt-1 text-muted-foreground">
          登录 NewAPI 后到「个人设置」页，页面上会显示用户 ID（整数）。或在 URL <span className="font-mono">/user</span> 后的数字。
        </p>
      </PopoverContent>
    </Popover>
  )
}

function Sub2APITokenHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <HelpCircle className="size-3" />
          如何获取？
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-xs" align="end">
        <p className="font-medium text-foreground">获取 Access Token</p>
        <ol className="mt-1 ml-4 list-decimal space-y-0.5 text-muted-foreground">
          <li>在浏览器登录 Sub2API 站点</li>
          <li>按 F12 打开 DevTools，切到 Application / 存储 标签</li>
          <li>左侧 Local Storage 选中站点域名</li>
          <li>找到 <span className="font-mono text-foreground">access_token</span> 字段并复制</li>
        </ol>
        <p className="mt-2 text-[11px] text-muted-foreground">
          也可以在 Network 标签里找任意接口的 <span className="font-mono">Authorization</span> 头，去掉 <span className="font-mono">Bearer </span> 前缀。
        </p>
      </PopoverContent>
    </Popover>
  )
}
