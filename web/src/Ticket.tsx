import type { Ticket, TxnSummary } from "./api";
import { money, shortDate, txnAmount, weekday } from "./format";
import { Mark } from "./Mark";

/** 流水行的标题：车次和起止站。 */
export function ticketTitle(k: Ticket): string {
  return `${k.train} ${k.from} → ${k.to}`;
}

/** 流水行副标题的开头：流水按付款日排，所以写开车时间；退票写退票费或「全额退款」。 */
export function ticketLead(k: Ticket): string {
  if (k.refund) return k.fee ? `退票费 ${money(k.fee)}` : "全额退款";
  const [day, time] = k.depart.split(" ");
  return [`${shortDate(day)} ${weekday(day)} ${time} 开`, k.tickets && `${k.tickets} 张`].filter(Boolean).join(" · ");
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} 时${m ? ` ${m} 分` : ""}` : `${m} 分`;
}

const cents = (s: string) => Math.round(Number(s) * 100);

/** 交易详情顶部的车票，手机详情页和电脑端的详情栏共用。 */
export function TicketCard({ t, ticket: k, currency }: { t: TxnSummary; ticket: Ticket; currency: string }) {
  const amt = txnAmount(t, currency);
  const [day, departTime] = k.depart.split(" ");
  const [arriveDay, arriveTime] = k.arrive?.split(" ") ?? [];
  const seat = [k.seat, k.tickets && `${k.tickets} 张`, k.fee && `手续费 ${money(k.fee)}`].filter(Boolean).join(" · ");
  return (
    <section className={"ticket" + (k.refund ? " is-refund" : "")} aria-label={`车票 ${ticketTitle(k)}${k.refund ? "（已退）" : ""}`}>
      <div className="num ticket-head">
        <Mark brand={t.brand} fallback={t.payee || k.train} size={20} radius={6} fontSize={11} />
        <span className="ticket-payee">{t.payee || t.brand?.name}</span>
        <span className="ticket-day">
          {day} {weekday(day)}
        </span>
      </div>
      <div className="ticket-route">
        <span className="ticket-end">
          <span className="ticket-station">{k.from}</span>
          <span className="num ticket-time">{departTime} 开</span>
        </span>
        <span className="ticket-train">
          <span className="ticket-no">{k.train}</span>
          <svg aria-hidden="true" className="ticket-arrow" viewBox="0 0 64 8" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 4h61M58 1l4 3-4 3" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="num ticket-time">{k.minutes != null && duration(k.minutes)}</span>
        </span>
        <span className="ticket-end is-to">
          <span className="ticket-station">{k.to}</span>
          <span className="num ticket-time">
            {arriveTime && `${arriveDay !== day ? `${shortDate(arriveDay)} ` : ""}${arriveTime} 到`}
          </span>
        </span>
      </div>
      {k.refund && <span className="ticket-stamp">已退</span>}
      <div className="ticket-tear" aria-hidden="true" />
      {k.refund && k.fee ? (
        <dl className="num ticket-fee">
          <dt>原票</dt>
          <dd>{money((cents(t.amount) + cents(k.fee)) / 100)}</dd>
          <dt>退票费</dt>
          <dd className="is-fee">{money(-cents(k.fee) / 100)}</dd>
          <dt className="is-back">退回</dt>
          <dd className={`ticket-amount tone-${amt.tone}`}>{amt.text}</dd>
        </dl>
      ) : (
        <div className="ticket-foot">
          <span className="ticket-seat">{k.refund ? ["全额退款", k.tickets && `${k.tickets} 张`].filter(Boolean).join(" · ") : seat}</span>
          <span className={`num ticket-amount tone-${amt.tone}`}>{amt.text}</span>
        </div>
      )}
    </section>
  );
}
