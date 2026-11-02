import { Fragment, useEffect, useRef, useState } from "react";
import { ENTRY_TYPES, type Day, type TxnSummary } from "./api";
import { CategorySheet } from "./CategorySheet";
import { CategoryTag, DeskPage, FundList } from "./DeskPage";
import { DeskDirectiveRow, directiveFacts, directiveView } from "./Directive";
import { dayLabel, money, shortDate, txnAmount, weekday } from "./format";
import { CategoryTile, Icon, categoryStyle } from "./icons";
import { dayTotal, FILTER_KEYS, FILTER_TITLES, futureLabel, futureTotal, queryToUrl, TYPE_LABELS, useJournal, type FilterKey } from "./journalState";
import { Mark } from "./Mark";
import { navigate } from "./router";
import { Sheet } from "./Sheet";
import { TicketCard, ticketHead, ticketIcon, ticketLead } from "./Ticket";
import { commitTime, COPY_LABEL, copyText, useTxnDetail } from "./Txn";

const txnPath = (id: string) => `/txn/${encodeURIComponent(id)}`;

function JournalRow({ t, currency, on, onPick }: { t: TxnSummary; currency: string; on: boolean; onPick: (t: TxnSummary) => void }) {
  const amt = txnAmount(t, currency);
  const head = t.ticket && ticketHead(t, t.ticket);
  const ref = useRef<HTMLAnchorElement>(null);
  // 直接打开 /txn/<id> 时，选中的那笔滚到看得见的地方
  useEffect(() => {
    if (on) ref.current?.scrollIntoView({ block: "nearest" });
  }, [on]);
  return (
    <a
      ref={ref}
      href={txnPath(t.id)}
      className={"desk-row" + (on ? " is-on" : "")}
      aria-current={on || undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        onPick(t);
      }}
    >
      <Mark brand={t.brand} fallback={t.payee || t.narration} size={38} radius={11} fontSize={16} icon={ticketIcon(t.ticket)} />
      <span className="desk-txn-text">
        <span className="desk-txn-title">
          {t.flag === "!" && <span className="flag">待确认</span>}
          {head ? (
            <>
              {t.ticket?.refund && <span className="refund-tag">退</span>}
              {head.title}
              {head.suffix && <span className="desk-txn-narration"> · {head.suffix}</span>}
            </>
          ) : t.payee && t.narration ? (
            <>
              {t.payee} <span className="desk-txn-narration">· {t.narration}</span>
            </>
          ) : (
            t.payee || t.narration || "（无摘要）"
          )}
        </span>
        <span className="desk-txn-sub">
          {t.ticket ? (
            // 票把分类换成开车时间或入园日期，退票写退票费；门票用绿色，和门票图标一个色
            <span className="desk-tag-cat num" style={{ ["--c" as string]: t.ticket.refund ? "var(--red)" : t.ticket.kind === "attraction" ? "var(--spot-bg)" : categoryStyle(t.category?.account).color }}>
              {!t.ticket.refund && <Icon name={t.ticket.kind === "train" ? "clock" : "calendar"} size={13} stroke={2.2} />}
              {ticketLead(t.ticket)}
            </span>
          ) : (
            <CategoryTag category={t.category} />
          )}
          <FundList t={t} />
        </span>
      </span>
      {t.tags.map((tag) => (
        <span key={tag} className="desk-row-tag">
          #{tag}
        </span>
      ))}
      <span className={`num amount desk-row-amount tone-${amt.tone}`}>{amt.text}</span>
    </a>
  );
}

/** 右侧详情栏，内容同手机交易详情页：分录、状态、源文件和行号、最后一次提交、复制给 AI、同收付方的其他交易。 */
function TxnPane({ id, currency, onClose, onPick }: { id: string; currency: string; onClose: () => void; onPick: (id: string) => void }) {
  const scrollRef = useRef<HTMLElement>(null);
  const { txn: entry, error, copied, onCopy, showSource, setShowSource } = useTxnDetail(id, scrollRef);
  const txn = entry?.type === "txn" ? entry : null;
  const directive = entry && entry.type !== "txn" ? entry : null;
  const view = directive && directiveView(directive, currency);
  const amt = txn && txnAmount(txn, currency);
  const cat = txn?.category;

  // 源文件、提交、复制给 AI 和查看源文件，交易和其他指令一样
  const sourceMeta = entry && (
    <>
      <dt>来源</dt>
      <dd className="mono small wrap">
        {entry.source.file}:{entry.source.line}
      </dd>
      <dt>提交</dt>
      <dd className="mono small">{entry.commit ? `${entry.commit.hash} · ${commitTime(entry.commit.time)}` : "未提交"}</dd>
    </>
  );
  const actions = entry && (
    <>
      <div className="desk-pane-actions">
        <button type="button" className="desk-btn-primary" onClick={onCopy}>
          {COPY_LABEL[copied]}
        </button>
        <button type="button" className="desk-btn" onClick={() => setShowSource((s) => !s)} aria-expanded={showSource}>
          {showSource ? "收起源文件" : "查看源文件"}
        </button>
      </div>
      {copied !== "no" && (
        <div className="copy-preview">
          {copyText(entry)}
          <span className="muted">在这里写要怎么改</span>
        </div>
      )}
      {showSource && (
        <pre className="source mono">
          <span className="source-path">
            {entry.source.file}:{entry.source.line}
          </span>
          {entry.source.text}
        </pre>
      )}
    </>
  );

  return (
    <aside className="desk-pane" aria-label="交易详情" ref={scrollRef}>
      <button type="button" className="desk-pane-close" aria-label="关闭详情" title="关闭（Esc）" onClick={onClose}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
      {error && <div className="notice">{error}</div>}
      {!entry && !error && <div className="notice">加载中…</div>}
      {directive && view && (
        <>
          <div className="desk-pane-hero">
            <div className="desk-pane-who">
              <Mark brand={directive.brand} fallback={directive.name} size={48} radius={14} fontSize={20} />
              <span className="desk-pane-name">
                <span className="desk-pane-payee">{view.title}</span>
                <span className="num desk-pane-date">
                  {directive.date} {weekday(directive.date)}
                </span>
              </span>
            </div>
            <span className="desk-pane-amount-line">
              {view.amount && <span className={`num desk-pane-amount tone-${view.tone}`}>{view.amount}</span>}
              <span className="pill pill-cat" style={{ ["--c" as string]: view.color }}>
                <Icon name={view.icon} size={14} stroke={2.2} />
                {view.label}
              </span>
            </span>
          </div>

          <dl className="desk-pane-meta">
            {directiveFacts(directive).map(([label, value, mono]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd className={mono ? "mono small wrap" : "wrap"}>{value}</dd>
              </Fragment>
            ))}
            {sourceMeta}
          </dl>

          {actions}
        </>
      )}
      {txn && amt && (
        <>
          {txn.ticket ? (
            <div className="desk-pane-hero">
              <TicketCard t={txn} ticket={txn.ticket} currency={currency} />
              <span className="num desk-pane-date">
                {txn.date} {weekday(txn.date)} {txn.ticket.refund ? "退票" : "购票"} · {txn.flag === "!" ? "待确认" : "已确认"} <span className="mono">{txn.flag}</span>
              </span>
            </div>
          ) : (
            <div className="desk-pane-hero">
              <div className="desk-pane-who">
                <Mark brand={txn.brand} fallback={txn.payee || txn.narration} size={48} radius={14} fontSize={20} />
                <span className="desk-pane-name">
                  <span className="desk-pane-payee">{txn.payee || txn.narration || "（无摘要）"}</span>
                  <span className="num desk-pane-date">
                    {txn.date} {weekday(txn.date)} · {txn.flag === "!" ? "待确认" : "已确认"} <span className="mono">{txn.flag}</span>
                  </span>
                </span>
              </div>
              {txn.payee && txn.narration && <span className="desk-pane-narration">{txn.narration}</span>}
              <span className="desk-pane-amount-line">
                <span className={`num desk-pane-amount tone-${amt.tone}`}>{amt.text}</span>
                <span className="pill pill-cat" style={{ ["--c" as string]: categoryStyle(cat?.account).color }}>
                  <Icon name={categoryStyle(cat?.account).icon} size={14} stroke={2.2} />
                  {cat?.name ?? "转账"}
                </span>
              </span>
            </div>
          )}

          <div className="desk-pane-postings">
            <span className={"card-label" + (txn.balanced ? "" : " is-bad")}>分录 · {txn.balanced ? "已平衡" : "不平衡"}</span>
            {txn.postings.map((p, i) => (
              <div key={i} className="posting">
                {p.group ? <CategoryTile account={p.account} size={28} radius={8} iconSize={15} /> : <Mark brand={p.brand} fallback={p.name} size={28} radius={8} fontSize={13} />}
                <span className="posting-text">
                  <span className="posting-name">{p.name}</span>
                  <span className="mono posting-account" title={p.account}>
                    {p.account}
                  </span>
                </span>
                <span className="num posting-amount">
                  {p.amount == null ? "" : money(p.amount)}
                  {p.currency && p.currency !== currency ? ` ${p.currency}` : ""}
                </span>
              </div>
            ))}
          </div>

          <dl className="desk-pane-meta">
            <dt>标签</dt>
            <dd>{txn.tags.length ? txn.tags.map((x) => `#${x}`).join(" ") : "—"}</dd>
            {sourceMeta}
          </dl>

          {actions}

          {txn.others.length > 0 && (
            <section className="desk-pane-others">
              <h2>{txn.payee || txn.brand?.name}的其他交易</h2>
              {txn.others.map((o) => {
                const a = txnAmount(o, currency);
                return (
                  <a key={o.id} href={txnPath(o.id)} className="desk-other" onClick={(e) => (e.preventDefault(), onPick(o.id))}>
                    <CategoryTile account={o.category?.account} size={28} radius={8} iconSize={14} stroke={2.1} />
                    <span className="row-text">
                      <span className="row-title-plain">{o.narration || o.payee || "（无摘要）"}</span>
                      <span className="num row-sub">
                        {shortDate(o.date)} · {o.category?.name ?? "转账"}
                      </span>
                    </span>
                    <span className={`num amount tone-${a.tone}`}>{a.text}</span>
                  </a>
                );
              })}
            </section>
          )}
        </>
      )}
    </aside>
  );
}

/** 电脑端流水，对应画布 Desktop-Journal：左边按日分组的列表，右边是选中那笔的详情。
 *  selected 是地址 /txn/<id> 里的交易，没有时右边是提示；筛选、搜索、分页同手机流水（useJournal）。 */
export function DesktopJournal({
  shown,
  active,
  search,
  onToast,
  selected,
  currency: fallbackCurrency,
}: {
  shown: boolean;
  active: boolean;
  search: string | null;
  onToast: (msg: string) => void;
  selected: string | null;
  currency: string;
}) {
  const bodyRef = useRef<HTMLElement>(null);
  const { query, data, error, loadingMore, onScroll, sheet, setSheet, openSheet, facets, options, chipLabel, pick, clearSearch, futureOpen, setFutureOpen, types, toggleType } = useJournal({
    search,
    active,
    onToast,
    listRef: bodyRef,
  });
  const [anchor, setAnchor] = useState<DOMRect>();
  const currency = data?.currency ?? fallbackCurrency;
  const future = data?.future;
  // 交易关着时只看得到其他指令，日合计和预记合计不写，免得像是这些指令的金额
  const showTotals = types.includes("txn");

  // 详情栏开着的是预记的交易（直接打开 /txn/<id>、从其他交易点过去）时展开预记组，那一行挂上后自己滚到看得见
  // 只在换了选中的交易或它刚加载出来时展开，翻页不会把用户收起的组再打开
  const selectedIsFuture = Boolean(selected && future?.days.some((d) => d.items.some((t) => t.id === selected)));
  useEffect(() => {
    if (selectedIsFuture) setFutureOpen(true);
  }, [selected, selectedIsFuture, setFutureOpen]);

  // 点一笔在右边打开：从流水点开的记一条历史，之后在详情栏里换着看只替换；关掉时退回流水，
  // 开着详情时改过筛选（或者是直接打开、从概览点进来的）就原地换成流水的地址
  const open = (id: string) => {
    const url = queryToUrl(query, txnPath(id));
    if (location.pathname.startsWith("/txn/")) navigate(url, { replace: true, pane: history.state?.pane });
    else navigate(url, { pane: queryToUrl(query) });
  };
  const close = () => {
    if (history.state?.pane === queryToUrl(query)) history.back();
    else navigate(queryToUrl(query), { replace: true });
  };

  // Esc 关掉详情栏；开着筛选下拉框时先关下拉框
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active || !selected || sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, selected, sheet]);

  const day = (d: Day) => (
    <div key={d.date}>
      <div className="num desk-day">
        <span className="desk-day-date">{dayLabel(d.date)}</span>
        <span>{d.weekday}</span>
        <span className="day-total">{showTotals && dayTotal(d)}</span>
      </div>
      {d.items.map((t) =>
        t.type === "txn" ? (
          <JournalRow key={t.id} t={t} currency={currency} on={t.id === selected} onPick={(x) => open(x.id)} />
        ) : (
          <DeskDirectiveRow key={t.id} d={t} currency={currency} on={t.id === selected} onPick={(x) => open(x.id)} />
        ),
      )}
    </div>
  );

  const filterButton = (key: FilterKey) => (
    <button
      type="button"
      key={key}
      className={"desk-filter" + (key !== "time" && query[key] ? " is-on" : "")}
      aria-haspopup="dialog"
      onClick={(e) => {
        setAnchor(e.currentTarget.getBoundingClientRect());
        openSheet(key);
      }}
    >
      {chipLabel(key)} ▾
    </button>
  );

  return (
    <DeskPage
      shown={shown}
      active={active}
      title="流水"
      subtitle={data ? `${chipLabel("time")} · ${data.count.toLocaleString("en-US")} 条 · 支出 ¥${money(data.expense)} · 收入 ¥${money(data.income)}` : " "}
      actions={<div className="desk-filters">{FILTER_KEYS.map(filterButton)}</div>}
      bodyRef={bodyRef}
      onScroll={onScroll}
    >
      {query.q && (
        <div className="desk-active">
          <span className="desk-search-chip">
            搜索「{query.q}」
            <button type="button" aria-label="清除搜索" onClick={clearSearch}>
              ×
            </button>
          </span>
        </div>
      )}

      {/* 画布那排类型开关；条数跟着筛选走，不含预记 */}
      <div className="kind-toggles" role="group" aria-label="分录类型">
        {ENTRY_TYPES.map((t) => (
          <button type="button" key={t} className={"kind-toggle" + (types.includes(t) ? " is-on" : "")} aria-pressed={types.includes(t)} onClick={() => toggleType(t)}>
            {TYPE_LABELS[t]} <span className="num kind-count">{data ? data.types[t].toLocaleString("en-US") : ""}</span>
          </button>
        ))}
      </div>

      <div className="desk-split">
        <section className="desk-list" aria-label="交易列表">
          {error && <div className="notice">加载失败：{error}</div>}
          {!data && !error && <div className="notice">加载中…</div>}
          {/* 今天以后的预记交易收在最上面，默认收起 */}
          {future && (
            <div className={"desk-future" + (futureOpen ? " is-open" : "")}>
              <button type="button" className="num desk-future-head" aria-expanded={futureOpen} onClick={() => setFutureOpen(!futureOpen)}>
                <span className="desk-day-date">预记</span>
                <span>{futureLabel(future)}</span>
                <span className="desk-future-end">
                  <span>{showTotals && futureTotal(future)}</span>
                  <span className="acct-chev" aria-hidden="true">
                    {futureOpen ? "▲" : "▼"}
                  </span>
                </span>
              </button>
              {futureOpen && future.days.map(day)}
            </div>
          )}
          {data && !data.days.length && <div className="notice">{future ? "今天及以前没有符合条件的交易" : "这段时间没有符合条件的交易"}</div>}
          {data?.days.map(day)}
          {data && data.days.length > 0 && <div className="desk-list-foot">{loadingMore ? "加载中…" : data.next ? "向下滚动加载更早的交易" : "没有更早的交易了"}</div>}
        </section>

        {selected ? (
          <TxnPane id={selected} currency={currency} onClose={close} onPick={open} />
        ) : (
          <aside className="desk-pane desk-pane-empty" aria-label="交易详情">
            点一笔交易，在这里看分录、源文件和提交
          </aside>
        )}
      </div>

      {sheet === "category" ? (
        <CategorySheet facets={facets} value={query.category} onPick={(v) => pick("category", v)} onClose={() => setSheet(null)} anchor={anchor} />
      ) : (
        sheet && <Sheet title={FILTER_TITLES[sheet]} options={options(sheet)} value={query[sheet]} clearable={sheet !== "time"} onPick={(v) => pick(sheet, v)} onClose={() => setSheet(null)} anchor={anchor} />
      )}
    </DeskPage>
  );
}
