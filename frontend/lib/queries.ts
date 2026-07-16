"use client"

import { useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/api"
import { useRefreshTick } from "@/lib/refresh-context"
import type {
  BalanceTrendPoint,
  CaptchaConfig,
  Channel,
  DashboardSummary,
  NotificationChannel,
  NotificationLog,
  RateChangeLog,
  RateSnapshot,
} from "@/lib/api-types"

export interface QueryState<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

/**
 * In-flight 请求去重：同一个 URL 在同一个 tick 内只发一次，所有 useApi 共享 Promise。
 *
 * 为什么需要：useDashboardSummary() 在 5 个组件里都被调用，没去重的话每次 mount /
 * refresh 都会发 5 个相同请求。开发环境叠加 StrictMode 翻倍后会更夸张。
 */
const inflight = new Map<string, Promise<unknown>>()

/** Cache 已完成的响应一小段时间，便于同一帧内挂载的多个组件共享结果（即使第一次的 Promise 已经 resolve）。 */
interface CacheEntry {
  data: unknown
  expiresAt: number
}
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 800

function cacheKey(path: string, tick: number, bump: number) {
  return `${path}#${tick}#${bump}`
}

function fetchShared<T>(path: string, key: string): Promise<T> {
  const now = Date.now()

  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) {
    return Promise.resolve(cached.data as T)
  }

  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) return existing

  const p = apiFetch<T>(path)
    .then((d) => {
      cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL_MS })
      return d
    })
    .finally(() => {
      // 让下一帧（refresh tick++）拉到新的数据，不要永远 hold 住旧 promise
      inflight.delete(key)
    })
  inflight.set(key, p)
  return p
}

/**
 * useApi 通用数据获取 hook（stale-while-revalidate）。
 * - 首次加载：loading = true，组件显示加载占位
 * - 后续刷新（refresh tick / refetch）：保留旧 data 继续展示，loading 不切回 true，后台静默拉新
 * - 同 URL + 同 tick 的并发调用共享一次请求
 */
function useApi<T>(path: string | null): QueryState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState<boolean>(path !== null)
  const [error, setError] = useState<string | null>(null)
  const [bump, setBump] = useState(0)
  const globalTick = useRefreshTick()

  // 已经拿到过数据吗？用 ref 防止 setLoading 写回触发额外 effect。
  const hasDataRef = useRef(false)

  useEffect(() => {
    if (path === null) {
      setLoading(false)
      return
    }
    let cancelled = false
    // 关键：只有第一次（还没拿到过数据）才展示 loading；后续 polling / refetch 静默进行，
    // 避免组件因 loading=true 短暂消失再回来造成"闪屏"。
    if (!hasDataRef.current) setLoading(true)
    setError(null)
    fetchShared<T>(path, cacheKey(path, globalTick, bump))
      .then((d) => {
        if (cancelled) return
        hasDataRef.current = true
        setData(d)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path, bump, globalTick])

  return {
    data,
    loading,
    error,
    refetch: () => setBump((b) => b + 1),
  }
}

export function useDashboardSummary() {
  return useApi<DashboardSummary>("/dashboard/summary")
}

export type BalanceTrendRange = "7d" | "24h"

export function useBalanceTrend(range: BalanceTrendRange = "7d") {
  const path = range === "24h"
    ? "/dashboard/balance-trend?bucket=hour&hours=24"
    : "/dashboard/balance-trend?days=7"
  return useApi<BalanceTrendPoint[]>(path)
}

export function useChannels() {
  return useApi<Channel[]>("/channels")
}

export function useChannelRates(channelID: number | null) {
  return useApi<RateSnapshot[]>(channelID == null ? null : `/channels/${channelID}/rates`)
}

export function useRateChanges(limit = 20, channelID?: number) {
  const q = new URLSearchParams()
  q.set("limit", String(limit))
  if (channelID != null) q.set("channel_id", String(channelID))
  return useApi<RateChangeLog[]>(`/rate-changes?${q.toString()}`)
}

export function useNotificationChannels() {
  return useApi<NotificationChannel[]>("/notifications/channels")
}

export function useNotificationLogs(limit = 20) {
  return useApi<NotificationLog[]>(`/notifications/logs?limit=${limit}`)
}

export function useCaptchaConfigs() {
  return useApi<CaptchaConfig[]>("/captcha-configs")
}
