import { NotificationStatus } from "@/components/monitor/bottom-panels"

export default function NotificationsPage() {
  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{"通知渠道"}</h1>
          <p className="text-xs text-muted-foreground">
            {"Telegram / Webhook / 邮件 / 企业微信 / 钉钉 / 飞书 / Bark。每个渠道可单独订阅指定上游和分组。"}
          </p>
        </div>
      </header>
      <NotificationStatus />
    </section>
  )
}
