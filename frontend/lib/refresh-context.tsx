"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react"

interface RefreshContextValue {
  tick: number
  bump: () => void
}

const RefreshContext = createContext<RefreshContextValue>({
  tick: 0,
  bump: () => {},
})

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])
  return (
    <RefreshContext.Provider value={{ tick, bump }}>
      {children}
    </RefreshContext.Provider>
  )
}

/** useRefreshTick 在 tick 变化时让组件重新拉数据。 */
export function useRefreshTick() {
  return useContext(RefreshContext).tick
}

/** useTriggerRefresh 返回手动 bump 的方法，比如点头部的"刷新"按钮。 */
export function useTriggerRefresh() {
  return useContext(RefreshContext).bump
}
