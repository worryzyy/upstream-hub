import { MonitorHeader } from "@/components/monitor/monitor-header"
import { KpiRow } from "@/components/monitor/kpi-row"
import { BalanceOverview } from "@/components/monitor/balance-overview"
import { MultiplierChanges } from "@/components/monitor/multiplier-changes"
import { ChannelCards } from "@/components/monitor/channel-cards"
import { ChannelRatesPanel } from "@/components/monitor/channel-rates-panel"
import { BottomPanels } from "@/components/monitor/bottom-panels"
import { DockBar } from "@/components/monitor/dock-bar"

export default function Page() {
  return (
    <div className="min-h-screen bg-background">
      <MonitorHeader />
      <main className="mx-auto max-w-[1440px] space-y-5 px-5 py-5 pb-24">
        <KpiRow />

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <BalanceOverview />
          </div>
          <div className="lg:col-span-2">
            <MultiplierChanges />
          </div>
        </div>

        <ChannelCards />

        <ChannelRatesPanel />

        <BottomPanels />
      </main>

      <DockBar />
    </div>
  )
}
