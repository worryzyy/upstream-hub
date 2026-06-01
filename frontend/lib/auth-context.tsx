"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  apiFetch,
  getToken,
  setToken,
  setUnauthorizedHandler,
} from "@/lib/api"

type AuthStatus = "loading" | "anonymous" | "authenticated"

interface AuthContextValue {
  status: AuthStatus
  username: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface LoginResponse {
  token: string
  expires_at: number
  username: string
}

interface MeResponse {
  username: string
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() =>
    getToken() ? "loading" : "anonymous",
  )
  const [username, setUsername] = useState<string | null>(null)

  // 启动时如果本地有 token，先 /auth/me 验证一下。失败就清掉。
  useEffect(() => {
    let cancelled = false
    if (!getToken()) {
      setStatus("anonymous")
      return
    }
    apiFetch<MeResponse>("/auth/me")
      .then((me) => {
        if (cancelled) return
        setUsername(me.username)
        setStatus("authenticated")
      })
      .catch(() => {
        if (cancelled) return
        setToken(null)
        setUsername(null)
        setStatus("anonymous")
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 注册全局 401 回调：让 apiFetch 在任何业务请求 401 时把我们打回登录页。
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUsername(null)
      setStatus("anonymous")
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const login = useCallback(async (u: string, p: string) => {
    const res = await apiFetch<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: u, password: p }),
      skipAuthErrorHandler: true,
    })
    setToken(res.token)
    setUsername(res.username)
    setStatus("authenticated")
  }, [])

  const logout = useCallback(() => {
    // 后端是无状态 token，本地丢弃即可；顺手通知后端但不阻塞。
    apiFetch("/auth/logout", { method: "POST" }).catch(() => {})
    setToken(null)
    setUsername(null)
    setStatus("anonymous")
  }, [])

  const value = useMemo(
    () => ({ status, username, login, logout }),
    [status, username, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider")
  }
  return ctx
}
