/**
 * SSE 流读取：用 fetch 而非 EventSource，以便附带 Authorization Bearer 头。
 */

import { getToken, notifyUnauthorized } from "@/lib/api"

export type ProgressStage =
  | "captcha"
  | "session"
  | "login"
  | "balance"
  | "rates"
  | "done"
  | "error"

export interface ProgressEvent {
  stage: ProgressStage
  message: string
  ok?: boolean
  data?: unknown
  time: string
}

export interface SyncOptions {
  onEvent: (ev: ProgressEvent) => void
  signal?: AbortSignal
}

/**
 * syncChannelStream 触发 /api/channels/:id/sync，逐条消费 SSE 事件。
 * 流读完返回；网络 / 业务错误会被以 ProgressEvent 形式抛给 onEvent，再 throw。
 */
export async function syncChannelStream(
  channelID: number,
  { onEvent, signal }: SyncOptions,
): Promise<void> {
  const token = getToken()
  const res = await fetch(`/api/channels/${channelID}/sync`, {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal,
  })

  if (res.status === 401) {
    notifyUnauthorized()
    throw new Error("未登录或会话已过期")
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`sync 请求失败 (${res.status}): ${body || res.statusText}`)
  }
  if (!res.body) {
    throw new Error("浏览器不支持流式响应")
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let buf = ""

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        if (buf.trim()) flushBlock(buf, onEvent)
        return
      }
      buf += decoder.decode(value, { stream: true })
      // 按 SSE 帧切：两次换行表示一帧结束
      let idx
      // eslint-disable-next-line no-cond-assign
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        flushBlock(block, onEvent)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function flushBlock(block: string, onEvent: (ev: ProgressEvent) => void) {
  // 一帧可能包含多行；按 SSE 规范只关心以 "data:" 开头的行
  const lines = block.split("\n")
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart())
    }
  }
  if (dataLines.length === 0) return
  const payload = dataLines.join("\n")
  try {
    const ev = JSON.parse(payload) as ProgressEvent
    onEvent(ev)
  } catch {
    // 忽略不合法的帧
  }
}
