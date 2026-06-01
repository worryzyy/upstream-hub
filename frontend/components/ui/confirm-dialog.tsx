"use client"

import { useCallback, useRef, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
}

/**
 * useConfirm 把命令式 window.confirm 抽象成一个 Promise<boolean>。
 *
 *   const { confirm, dialog } = useConfirm()
 *   if (await confirm({ title: "..." })) doStuff()
 *
 * 调用方需要把 `dialog` 渲染在组件树里（一般放在根 JSX 末尾）。
 * Promise 在用户点击确认 / 取消 / 关闭弹窗时 resolve。
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({ open: false, title: "" })
  const resolverRef = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current?.(false)
      resolverRef.current = resolve
      setState({ ...opts, open: true })
    })
  }, [])

  const finish = useCallback((ok: boolean) => {
    const r = resolverRef.current
    resolverRef.current = null
    setState((s) => ({ ...s, open: false }))
    r?.(ok)
  }, [])

  const dialog = (
    <AlertDialog
      open={state.open}
      onOpenChange={(o) => {
        if (!o) finish(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state.title}</AlertDialogTitle>
          {state.description ? (
            <AlertDialogDescription>{state.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(false)}>
            {state.cancelLabel ?? "取消"}
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(
              state.destructive && buttonVariants({ variant: "destructive" }),
            )}
            onClick={() => finish(true)}
          >
            {state.confirmLabel ?? "确认"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { confirm, dialog }
}
