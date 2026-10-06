import { Link } from 'react-router-dom'
import { Delta, Kpi, Legend, PALETTE, PROVIDER_COLOURS, RankBars, TrendChart } from '../../../components/insightCharts'
import type { Insights } from '../../../lib/api'
import { bucketLabel, cedis, count, duration, hoursText, MiniStat, Panel, pct, providerName } from './shared'

export default function OperationsTab({ data }: { data: Insights }) {
  const { operations: ops, meta } = data
  const labels = ops.series.map((s) => bucketLabel(s.bucket as number, meta.granularity))
  const colour = (p: string) => PROVIDER_COLOURS[p] ?? PALETTE.slate
  const fastest = [...ops.byProvider].filter((p) => p.speed.paidToDelivered.p50 !== null).sort((a, b) => (a.speed.paidToDelivered.p50 ?? 0) - (b.speed.paidToDelivered.p50 ?? 0))[0]
  const slowest = [...ops.byProvider].filter((p) => p.speed.paidToDelivered.p50 !== null).sort((a, b) => (b.speed.paidToDelivered.p50 ?? 0) - (a.speed.paidToDelivered.p50 ?? 0))[0]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Delivered successfully" value={pct(ops.kpis.successRate.value, 1)} compared={ops.kpis.successRate} points emphasis hint="of paid orders" />
        <Kpi label="Typical time to deliver" value={duration(ops.kpis.medianMinutes.value * 60)} compared={ops.kpis.medianMinutes} higherIsBetter={false} hint="from payment" />
        <Kpi label="Failed after paying" value={count(ops.kpis.failedAfterPay.value)} compared={ops.kpis.failedAfterPay} higherIsBetter={false} />
        <Kpi
          label="Waiting to deliver now"
          value={count(ops.inFlight.count)}
          hint={ops.inFlight.count > 0 ? `${cedis(ops.inFlight.value)}, oldest ${duration(ops.inFlight.oldestMinutes * 60)}` : 'nothing stuck'}
        />
      </div>

      <Panel
        question="Which provider delivers better?"
        answer={
          fastest && slowest && fastest.provider !== slowest.provider
            ? `${providerName(fastest.provider)} is faster: ${duration(fastest.speed.paidToDelivered.p50)} typically, against ${duration(slowest.speed.paidToDelivered.p50)} for ${providerName(slowest.provider)}.`
            : ops.byProvider.length === 1
              ? `Only ${providerName(ops.byProvider[0].provider)} delivered in this period.`
              : 'No deliveries in this period.'
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          {ops.byProvider.map((p) => (
            <div key={p.provider} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-50">
                  <span className="size-2.5 rounded-full" style={{ background: colour(p.provider) }} />
                  {providerName(p.provider)}
                </span>
                <span className="text-xs text-slate-500">{count(p.delivered + p.failed)} paid orders</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Delivered</p>
                  <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">{pct(p.rate, 1)}</p>
                  <Delta value={p.rate} previous={p.previousRate} points />
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
                  <p className="text-xs text-slate-500 dark:text-slate-400">Typical delivery</p>
                  <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">{duration(p.speed.paidToDelivered.p50)}</p>
                  <p className="text-xs text-slate-500">slowest 1 in 10: {duration(p.speed.paidToDelivered.p90)}</p>
                </div>
              </div>
              <dl className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                <div className="flex justify-between"><dt>Delivered within 15 min</dt><dd className="font-semibold tabular-nums">{pct(p.speed.within15m)}</dd></div>
                <div className="flex justify-between"><dt>Payment to sent</dt><dd className="font-semibold tabular-nums">{duration(p.speed.paidToSent.p50)}</dd></div>
                <div className="flex justify-between"><dt>Sent to delivered</dt><dd className="font-semibold tabular-nums">{duration(p.speed.sentToDelivered.p50)}</dd></div>
                <div className="flex justify-between"><dt>Needed a retry or reorder</dt><dd className="font-semibold tabular-nums">{count(p.retried)}</dd></div>
                <div className="flex justify-between"><dt>Failed</dt><dd className="font-semibold tabular-nums">{count(p.failed)}</dd></div>
              </dl>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Payment to sent is this app; sent to delivered is the provider's own queue. Typical means half of orders were faster.
        </p>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel question="Is delivery getting faster or slower?" answer={`Typical minutes from payment to delivery, per ${meta.granularity}.`}>
          <Legend items={ops.providers.map((p) => ({ label: providerName(p), colour: colour(p) }))} />
          <div className="mt-3">
            <TrendChart
              labels={labels}
              format={(v) => duration(v * 60)}
              axisFormat={(v) => (v < 120 ? `${Math.round(v)}m` : `${Math.round(v / 60)}h`)}
              series={ops.providers.map((p) => ({ label: providerName(p), colour: colour(p), values: ops.series.map((s) => s[`${p}:minutes`] ?? null) }))}
            />
          </div>
        </Panel>
        <Panel question="Is the success rate holding?" answer={`Share of paid orders delivered, per ${meta.granularity}.`}>
          <Legend items={ops.providers.map((p) => ({ label: providerName(p), colour: colour(p) }))} />
          <div className="mt-3">
            <TrendChart
              labels={labels}
              format={(v) => `${Math.round(v)}%`}
              series={ops.providers.map((p) => ({ label: providerName(p), colour: colour(p), values: ops.series.map((s) => s[`${p}:rate`] ?? null) }))}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel
          question="Why do paid orders fail?"
          answer={ops.failureReasons[0] ? `Mostly: ${ops.failureReasons[0].reason}` : 'No paid order failed in this period.'}
        >
          <RankBars
            format={(v) => count(v)}
            colour={PALETTE.loss}
            rows={ops.failureReasons.map((r) => ({ key: r.reason, label: r.reason, value: r.count, detail: `${cedis(r.amount)} of orders` }))}
          />
        </Panel>
        <Panel
          question="Are refunds handled quickly?"
          answer={
            ops.refunds.waitingNow.count > 0
              ? `${count(ops.refunds.waitingNow.count)} still waiting, ${cedis(ops.refunds.waitingNow.amount)}.`
              : 'Nobody is waiting for a refund.'
          }
          action={
            ops.refunds.waitingNow.count > 0 ? (
              <Link to="/admin/refunds" className="shrink-0 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">Open refunds</Link>
            ) : undefined
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Refunds this period" value={count(ops.refunds.count)} />
            <MiniStat label="Amount" value={cedis(ops.refunds.amount)} />
            <MiniStat label="Typical wait to be paid back" value={hoursText(ops.refunds.medianHoursToSettle)} />
            <MiniStat
              label="Oldest still waiting"
              value={ops.refunds.waitingNow.count > 0 ? hoursText(ops.refunds.waitingNow.oldestHours) : 'none'}
              tone={ops.refunds.waitingNow.oldestHours > 24 ? 'bad' : undefined}
            />
          </div>
        </Panel>
        <Panel
          question="Which numbers are blocked by the provider?"
          answer={
            ops.blockedNumbers.stillBlocked > 0
              ? `${count(ops.blockedNumbers.stillBlocked)} numbers still wait for approval.`
              : 'No number is waiting for approval.'
          }
          action={
            ops.blockedNumbers.stillBlocked > 0 ? (
              <Link to="/admin/approvals" className="shrink-0 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">Open approvals</Link>
            ) : undefined
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Newly blocked" value={count(ops.blockedNumbers.newInRange)} />
            <MiniStat label="Approved" value={count(ops.blockedNumbers.resolvedInRange)} tone="good" />
            <MiniStat label="Typical wait" value={hoursText(ops.blockedNumbers.medianHoursToResolve)} />
            <MiniStat label="Sales held up" value={cedis(ops.blockedNumbers.stillBlockedValue)} />
          </div>
        </Panel>
      </div>
    </div>
  )
}
