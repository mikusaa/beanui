import type { AttractionTicket, Ticket, TrainTicket, TxnSummary } from "./api";
import { money, shortDate, txnAmount, weekday } from "./format";
import { Mark } from "./Mark";

/** 流水行的标题：车票是车次和起止站，门票是景区名。 */
export function ticketTitle(k: Ticket): string {
  return k.kind === "train" ? `${k.train} ${k.from} → ${k.to}` : k.attraction;
}

/** 流水行副标题的开头：流水按付款日排，所以写开车时间或入园日期；退票写退票费或「全额退款」。 */
export function ticketLead(k: Ticket): string {
  if (k.refund) return k.fee ? `退票费 ${money(k.fee)}` : "全额退款";
  const [day, time] = (k.kind === "train" ? k.depart : k.visit).split(" ");
  const when = k.kind === "train" ? `${shortDate(day)} ${weekday(day)} ${time} 开` : [shortDate(day), weekday(day), time, "入园"].filter(Boolean).join(" ");
  return [when, k.tickets && `${k.tickets} 张`].filter(Boolean).join(" · ");
}

/** 票的抬头「收付方 · 车次和起止站」，电脑端流水行和门票票头用；
 *  门票的收付方和景区名一样或为空时只有景区名，suffix 为 null。 */
export function ticketHead(t: TxnSummary, k: Ticket): { title: string; suffix: string | null } {
  const who = t.payee || t.brand?.name || "";
  if (k.kind === "attraction" && (!who || who === k.attraction)) return { title: k.attraction, suffix: null };
  return { title: who, suffix: ticketTitle(k) };
}

/** 门票缺品牌图时画门票图标，不画首字。 */
export const ticketIcon = (k: Ticket | null) => (k?.kind === "attraction" ? ("ticket" as const) : undefined);

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} 时${m ? ` ${m} 分` : ""}` : `${m} 分`;
}

const cents = (s: string) => Math.round(Number(s) * 100);

/** 交易详情顶部的票，手机详情页和电脑端的详情栏共用。 */
export function TicketCard({ t, ticket: k, currency }: { t: TxnSummary; ticket: Ticket; currency: string }) {
  return k.kind === "train" ? <TrainCard t={t} k={k} currency={currency} /> : <AttractionCard t={t} k={k} currency={currency} />;
}

/** 撕口下面：扣了手续费的退票列原票、退票费、退回三行，否则左边一行小字、右边金额。 */
function TicketFoot({ t, k, currency, note }: { t: TxnSummary; k: Ticket; currency: string; note: string }) {
  const amt = txnAmount(t, currency);
  if (k.refund && k.fee) {
    return (
      <dl className="num ticket-fee">
        <dt>原票</dt>
        <dd>{money((cents(t.amount) + cents(k.fee)) / 100)}</dd>
        <dt>退票费</dt>
        <dd className="is-fee">{money(-cents(k.fee) / 100)}</dd>
        <dt className="is-back">退回</dt>
        <dd className={`ticket-amount tone-${amt.tone}`}>{amt.text}</dd>
      </dl>
    );
  }
  return (
    <div className="ticket-foot">
      <span className="ticket-seat">{k.refund ? ["全额退款", k.tickets && `${k.tickets} 张`].filter(Boolean).join(" · ") : note}</span>
      <span className={`num ticket-amount tone-${amt.tone}`}>{amt.text}</span>
    </div>
  );
}

function TrainCard({ t, k, currency }: { t: TxnSummary; k: TrainTicket; currency: string }) {
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
      <TicketFoot t={t} k={k} currency={currency} note={seat} />
    </section>
  );
}

/** 门票：左边大字景区名，右边副券写入园日期；票头的收付方和景区名一样时写「门票」。 */
function AttractionCard({ t, k, currency }: { t: TxnSummary; k: AttractionTicket; currency: string }) {
  const [day, time] = k.visit.split(" ");
  const head = ticketHead(t, k);
  const note = [k.item, k.tickets && `${k.tickets} 张`, k.fee && `手续费 ${money(k.fee)}`].filter(Boolean).join(" · ");
  return (
    <section className={"ticket ticket-spot" + (k.refund ? " is-refund" : "")} aria-label={`门票 ${k.attraction}${k.refund ? "（已退）" : ""}`}>
      <div className="num ticket-head">
        <Mark brand={t.brand} fallback={head.title} size={20} radius={6} fontSize={11} icon="ticket" />
        <span className="ticket-payee">{head.suffix ? head.title : "门票"}</span>
      </div>
      <div className="ticket-spot-body">
        <span className="ticket-station">{k.attraction}</span>
        <span className="num ticket-stub">
          <span className="ticket-stub-day">{shortDate(day)}</span>
          <span className="ticket-stub-note">{[weekday(day), time, "入园"].filter(Boolean).join(" ")}</span>
          {k.refund && <span className="ticket-stamp">已退</span>}
        </span>
      </div>
      <div className="ticket-tear" aria-hidden="true" />
      <TicketFoot t={t} k={k} currency={currency} note={note} />
    </section>
  );
}
