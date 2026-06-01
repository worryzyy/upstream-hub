/**
 * 极简后端 API 客户端：自动附带 Authorization 头，401 触发全局登出。
 *
 * 设计目标：
 *   - 不引入 axios，沿用浏览器自带 fetch
 *   - token 存 localStorage，刷新页面后保持登录
 *   - 401 时触发 onUnauthorized，让上层清空 state、回到登录页
 */

const TOKEN_KEY = "uh_token"

let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token)
  } else {
    window.localStorage.removeItem(TOKEN_KEY)
  }
}

/** 通知全局已注册的 unauthorizedHandler：清 token 并触发回到登录页。 */
export function notifyUnauthorized() {
  setToken(null)
  unauthorizedHandler?.()
}

export interface ApiError extends Error {
  status: number
  body?: unknown
}

interface FetchOptions extends RequestInit {
  // 标记是登录请求本身，不要在 401 时触发登出回调（让 LoginPage 自己显示错误）。
  skipAuthErrorHandler?: boolean
}

/**
 * apiFetch 自动拼 /api 前缀、加 Authorization 头、统一解包 { data } 或抛错。
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const url = path.startsWith("/api") || path.startsWith("http")
    ? path
    : `/api${path.startsWith("/") ? path : `/${path}`}`

  const headers = new Headers(options.headers)
  headers.set("Accept", "application/json")
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  const token = getToken()
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  const res = await fetch(url, { ...options, headers })

  if (res.status === 401 && !options.skipAuthErrorHandler) {
    setToken(null)
    unauthorizedHandler?.()
  }

  let body: unknown = undefined
  const text = await res.text()
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }

  if (!res.ok) {
    const err: ApiError = Object.assign(
      new Error(
        (body as { error?: string })?.error ??
          (typeof body === "string" ? body : `HTTP ${res.status}`),
      ),
      { status: res.status, body },
    )
    throw err
  }

  // 习惯上后端返回 { data }，但部分端点直接返回扁平 JSON。两种都兼容。
  if (body && typeof body === "object" && "data" in (body as Record<string, unknown>)) {
    return (body as { data: T }).data
  }
  return body as T
}

export const TOKEN_STORAGE_KEY = TOKEN_KEY
