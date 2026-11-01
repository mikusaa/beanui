import { useRef, useState } from "react";
import type { Day, EntryType, TxnSummary } from "./api";
import { DirectiveRow } from "./Directive";
import { dayLabel, money, subtitle, title, txnAmount } from "./format";
import { CategoryTile } from "./icons";
import { dayTotal, DEFAULT_TYPES, FILTER_KEYS, FILTER_TITLES, futureLabel, futureTotal, typeOptions, useJournal } from "./journalState";
import { Mark } from "./Mark";
import { navigate } from "./router";
import { Sheet } from "./Sheet";
import { TabBar } from "./TabBar";
import { ticketLead, ticketTitle } from "./Ticket";

/** shown：流水是底下那一屏（上面可能盖着交易详情）；active：没被盖住；search：地址是 /journal 时的查询串。 */
export function Journal({ shown, active, search, onToast }: { shown: boolean; active: boolean; search: string | null; onToast: (msg: string) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { query, typed, setTyped, data, error, loadingMore, onScroll, sheet, setSheet, openSheet, options, chipLabel, pick, futureOpen, setFutureOpen, types, toggleType } = useJournal({
    search,
    active,
    onToast,
    listRef,
    searchRef,
  });

  const [typeSheet, setTypeSheet] = useState(false);
  const open = (t: { id: string }) => navigate(`/txn/${encodeURIComponent(t.id)}`);
  // 类型和默认的不一样时，「类型」标签点亮
  const typesChanged = types.join() !== DEFAULT_TYPES.join();
  const currency = data?.currency ?? "CNY";
  const future = data?.future;
  // 交易关着时只看得到其他指令，日合计和预记合计不写，免得像是这些指令的金额
  const showTotals = types.includes("txn");

  const day = (d: Day) => (
    <section key={d.date} className="day">
      <div className="num day-head">
        <span className="day-date">{dayLabel(d.date)}</span>
        <span>{d.weekday}</span>
        <span className="day-total">{showTotals && dayTotal(d)}</span>
      </div>
      <div className="card">
        {d.items.map((e) => {
          if (e.type !== "txn") return <DirectiveRow key={e.id} d={e} currency={currency} onOpen={open} />;
          const t: TxnSummary = e;
          const amt = txnAmount(t, currency);
          return (
            <a key={t.id} href={`/txn/${encodeURIComponent(t.id)}`} className="row" onClick={(e) => (e.preventDefault(), open(t))}>
              <span className="row-mark">
                <Mark brand={t.brand} fallback={t.payee || t.narration} size={40} radius={12} fontSize={16} />
                <CategoryTile account={t.category?.account} size={20} radius={10} iconSize={11} stroke={2.6} className="badge" />
              </span>
              <span className="row-text">
                <span className="row-title">
                  {t.flag === "!" && <span className="flag">待确认</span>}
                  {t.ticket?.refund && <span className="refund-tag">退</span>}
                  {t.ticket ? ticketTitle(t.ticket) : title(t)}
                </span>
                <span className="row-sub">{t.ticket ? subtitle(t, ticketLead(t.ticket)) : subtitle(t)}</span>
              </span>
              <span className={`num amount tone-${amt.tone}`}>{amt.text}</span>
            </a>
          );
        })}
      </div>
    </section>
  );

  return (
    <div className={"screen" + (shown ? "" : " is-hidden")} inert={!active}>
      <header className="journal-head">
        <h1>流水</h1>
        <label className="search">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input ref={searchRef} type="search" placeholder="收付方、备注、科目、#标签" aria-label="搜索流水" value={typed} onChange={(e) => setTyped(e.target.value)} enterKeyHint="search" />
        </label>
        <div className="chips">
          {FILTER_KEYS.map((key) => (
            <button type="button" key={key} className={"chip" + (key === "time" || query[key] ? " is-on" : "")} onClick={() => openSheet(key)}>
              {chipLabel(key)} ▾
            </button>
          ))}
          <button type="button" className={"chip" + (typesChanged ? " is-on" : "")} onClick={() => setTypeSheet(true)}>
            类型 ▾
          </button>
        </div>
        <span className="num summary">
          {data ? `${data.count.toLocaleString("en-US")} 条 · 支出 ¥${money(data.expense)} · 收入 ¥${money(data.income)}` : " "}
        </span>
      </header>

      <div className="journal-list" ref={listRef} onScroll={onScroll}>
        {error && <div className="notice">加载失败：{error}</div>}
        {!data && !error && <div className="notice">加载中…</div>}
        {/* 今天以后的预记交易收在最上面，默认收起 */}
        {future && (
          <section className={"future" + (futureOpen ? " is-open" : "")}>
            <button type="button" className="num future-head" aria-expanded={futureOpen} onClick={() => setFutureOpen(!futureOpen)}>
              <span className="day-date">预记</span>
              <span>{futureLabel(future)}</span>
              <span className="day-total">{showTotals && futureTotal(future)}</span>
              <span className="acct-chev" aria-hidden="true">
                {futureOpen ? "▲" : "▼"}
              </span>
            </button>
            {futureOpen && future.days.map(day)}
          </section>
        )}
        {data && !data.days.length && <div className="notice">{future ? "今天及以前没有符合条件的交易" : "这段时间没有符合条件的交易"}</div>}
        {data?.days.map(day)}
        <div className="notice">
          {loadingMore ? "加载中…" : data?.next ? " " : ""}
        </div>
      </div>

      <TabBar current="journal" onTop={() => listRef.current?.scrollTo({ top: 0, behavior: "smooth" })} onToast={onToast} />

      {typeSheet && (
        <Sheet title="类型" options={typeOptions(data?.types)} value="" values={types} clearable={false} onPick={(v) => toggleType(v as EntryType)} onClose={() => setTypeSheet(false)} />
      )}
      {sheet && <Sheet title={FILTER_TITLES[sheet]} options={options(sheet)} value={query[sheet]} clearable={sheet !== "time"} onPick={(v) => pick(sheet, v)} onClose={() => setSheet(null)} />}
    </div>
  );
}
