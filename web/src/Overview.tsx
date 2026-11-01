import { useEffect, useRef, useState } from "react";
import { fetchOverview, type CreditRow, type Overview as OverviewData, type Sync, type TxnSummary } from "./api";
import { money, percent, shortDate, title, txnAmount, yuan } from "./format";
import { CategoryTile } from "./icons";
import { queryToUrl } from "./journalState";
import { Mark } from "./Mark";
import { navigate } from "./router";
import { ago, startSync, SYNC_LABEL, syncDetail, syncTone, useDataVersion, useNow, useSyncing } from "./sync";
import { TabBar } from "./TabBar";

// 画布 Phone-Home 的五个时间范围；流水页的「时间」也认这几个值，电脑端概览也用这几个
export const RANGES = [
  { value: "week", label: "本周", compare: "较上周同期" },
  { value: "month", label: "本月", compare: "较上月同期" },
  { value: "last-month", label: "上月", compare: "较前一月" },
  { value: "3months", label: "近三月", compare: "较前三月同期" },
  { value: "year", label: "今年", compare: "较去年同期" },
];
const DEFAULT_RANGE = "month";
const TOP_CATEGORIES = 5;

// 从别的标签切回概览时保留时间范围
let lastUrl = "/";
export const overviewUrl = () => lastUrl;

function rangeFromUrl(search: string): string {
  const t = new URLSearchParams(search).get("time");
  return RANGES.some((r) => r.value === t) ? t! : DEFAULT_RANGE;
}

/** 大标题：本月「10 月」，近三月「8–10 月」，今年「2026 年」。 */
function heading(range: string, start: string, end: string): string {
  const [y1, m1] = start.split("-").map(Number);
  const [y2, m2] = end.split("-").map(Number);
  if (range === "week") return "本周";
  if (range === "year") return `${y2} 年`;
  const year = y2 === new Date().getFullYear() ? "" : `${y2} 年 `;
  if (y1 === y2 && m1 === m2) return `${year}${m2} 月`;
  return `${year}${m1}–${m2} 月`;
}

/** 时间范围跟着地址走：手机和电脑的概览共用，切范围时改地址，前进后退和切标签回来时按地址来。 */
export function useRange(search: string | null, active: boolean): [string, (range: string) => void] {
  const [range, setRange] = useState(() => rangeFromUrl(search ?? ""));

  useEffect(() => {
    if (search != null) setRange(rangeFromUrl(search));
  }, [search]);

  // 同流水页：只在范围变了时改地址
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    lastUrl = range === DEFAULT_RANGE ? "/" : `/?time=${range}`;
    if (activeRef.current) history.replaceState(history.state, "", lastUrl);
  }, [range]);

  return [range, setRange];
}

/** 额度一万以上写成「6.2 万」。 */
export function limitText(value: string): string {
  const n = Number(value);
  if (n < 10000) return money(n).replace(/\.00$/, "");
  return `${Number((n / 10000).toFixed(2))} 万`;
}

function SyncBadge({ sync, onToast }: { sync: Sync; onToast: (msg: string) => void }) {
  const now = useNow();
  const tone = syncTone(sync, now);
  const text = `${SYNC_LABEL[tone]} · ${ago(sync.time, now)}`;
  const detail = syncDetail(sync);
  return (
    <button type="button" className={`sync sync-${tone}`} title={detail} onClick={() => onToast(detail)}>
      <span className="sync-dot" aria-hidden="true" />
      {text}
    </button>
  );
}

/** 手动同步：NAS 上才有（can_sync），点了转圈，git-sync 拉完重新取数据。 */
function SyncButton({ onToast }: { onToast: (msg: string) => void }) {
  const syncing = useSyncing();
  return (
    <button type="button" className="icon-btn" aria-label={syncing ? "同步中" : "同步"} title="从 GitHub 拉取最新账本" disabled={syncing} onClick={() => startSync(onToast)}>
      <svg className={syncing ? "spin" : undefined} aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" />
      </svg>
    </button>
  );
}

function CreditCard({ row }: { row: CreditRow }) {
  const pct = row.utilization;
  return (
    <div className="credit-card">
      <span className="credit-bank">
        <Mark brand={row.brand} fallback={row.bank} size={22} radius={7} fontSize={11} />
        <span className="credit-bank-name">{row.bank}</span>
      </span>
      <span className="num credit-avail">{yuan(row.available ?? row.used)}</span>
      <span className="credit-hint">{row.limit != null ? `可用 · 额度 ${limitText(row.limit)}` : "已用 · 未设置额度"}</span>
      <div className="credit-meter">
        <div className="bar bar-thin" role="progressbar" aria-label={`${row.bank}额度使用率`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct == null ? undefined : Math.max(0, Math.min(100, pct))}>
          {pct != null && <div className={`bar-fill level-${row.level}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />}
        </div>
        <span className="num credit-pct">{pct == null ? "—" : percent(pct)}</span>
      </div>
    </div>
  );
}

function RecentRow({ t, currency }: { t: TxnSummary; currency: string }) {
  const amt = txnAmount(t, currency);
  const account = (t.kind === "income" ? t.targets : t.sources)[0] ?? t.targets[0];
  const sub = [t.category?.name ?? "转账", shortDate(t.date), account].filter(Boolean).join(" · ");
  const href = `/txn/${encodeURIComponent(t.id)}`;
  return (
    <a href={href} className="row row-small" onClick={(e) => (e.preventDefault(), navigate(href))}>
      <span className="row-mark">
        <Mark brand={t.brand} fallback={t.payee || t.narration} size={40} radius={12} fontSize={16} />
        <CategoryTile account={t.category?.account} size={20} radius={10} iconSize={11} stroke={2.6} className="badge" />
      </span>
      <span className="row-text">
        <span className="row-title">
          {t.flag === "!" && <span className="flag">待确认</span>}
          {title(t)}
        </span>
        <span className="num row-sub">{sub}</span>
      </span>
      <span className={`num amount tone-${amt.tone}`}>{amt.text}</span>
    </a>
  );
}

/** shown、active、search 的意思同流水页。 */
export function Overview({ shown, active, search, onToast }: { shown: boolean; active: boolean; search: string | null; onToast: (msg: string) => void }) {
  const [range, setRange] = useRange(search, active);
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allCats, setAllCats] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const version = useDataVersion();

  // 每次回到概览都重新取一次，账本可能刚改过；同步完也取
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    setError(null);
    fetchOverview(range, ctrl.signal)
      .then(setData)
      .catch((e) => ctrl.signal.aborted || setError(e.message));
    return () => ctrl.abort();
  }, [range, active, version]);

  const r = RANGES.find((x) => x.value === range)!;
  const d = data; // 切范围时先留着旧数据，不闪成「加载中」
  const currency = d?.currency ?? "CNY";
  const cats = d?.categories ?? [];
  const shownCats = allCats ? cats : cats.slice(0, TOP_CATEGORIES);
  const maxCat = Math.max(...cats.map((c) => Number(c.amount)), 0);
  const change = d?.compare?.change;
  const credit = d?.credit;

  const toJournal = (q: Parameters<typeof queryToUrl>[0]) => navigate(queryToUrl({ time: range, ...q }));

  return (
    <div className={"screen" + (shown ? "" : " is-hidden")} inert={!active}>
      <div className="home-body" ref={bodyRef}>
        <header className="home-head">
          <div className="home-title">
            <span className="home-book">{d?.title || " "}</span>
            <h1>{d ? heading(range, d.start, d.end) : r.label}</h1>
          </div>
          {d?.sync && <SyncBadge sync={d.sync} onToast={onToast} />}
          {d?.sync?.can_sync && <SyncButton onToast={onToast} />}
          <button type="button" className="icon-btn" aria-label="搜索" onClick={() => navigate(queryToUrl({ time: "all" }) + "#search")}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </button>
        </header>

        <div className="chips" role="group" aria-label="时间范围">
          {RANGES.map((x) => (
            <button type="button" key={x.value} className={"chip chip-range" + (x.value === range ? " is-on" : "")} aria-pressed={x.value === range} onClick={() => setRange(x.value)}>
              {x.label}
            </button>
          ))}
        </div>

        {error && <div className="notice">加载失败：{error}</div>}
        {!d && !error && <div className="notice">加载中…</div>}

        {d && (
          <>
            <section className="hero-card">
              <div className="hero-main">
                <span className="hero-label">{r.label}支出</span>
                <span className="num hero-total">{yuan(d.expense)}</span>
                {d.compare && (
                  <span className="hero-label small">
                    {change == null ? (
                      <>{r.compare.slice(1)}没有支出</>
                    ) : (
                      <>
                        <span className={"num hero-change " + (change > 0 ? "is-up" : "is-down")}>{change === 0 ? "持平" : `${change > 0 ? "↑" : "↓"} ${percent(Math.abs(change))}`}</span> {r.compare}
                      </>
                    )}
                  </span>
                )}
              </div>
              <div className="hero-tiles">
                <div className="hero-tile">
                  <span className="hero-label small">收入</span>
                  <span className="num hero-tile-value">{yuan(d.income)}</span>
                </div>
                <div className="hero-tile">
                  <span className="hero-label small">结余{d.savings_rate != null && d.savings_rate >= -100 && ` · ${percent(d.savings_rate)}`}</span>
                  <span className="num hero-tile-value">{yuan(d.net)}</span>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>支出分类</h2>
                {cats.length > TOP_CATEGORIES && (
                  <button type="button" className="link-btn" onClick={() => setAllCats((v) => !v)}>
                    {allCats ? "收起" : `全部 ${cats.length} 类`}
                  </button>
                )}
              </div>
              {!cats.length && <div className="panel-empty">这段时间没有支出</div>}
              {shownCats.map((c) => (
                <button type="button" key={c.account} className="cat-row" onClick={() => toJournal({ category: c.account })}>
                  <span className="cat-line">
                    <span className="cat-name">
                      <CategoryTile account={c.account} size={24} radius={7} iconSize={13} stroke={2.2} />
                      {c.name}
                    </span>
                    <span className="num cat-amount">{yuan(c.amount)}</span>
                  </span>
                  <span className="bar" aria-hidden="true">
                    <span className="bar-fill" style={{ width: `${maxCat ? (Number(c.amount) / maxCat) * 100 : 0}%` }} />
                  </span>
                </button>
              ))}
            </section>

            {credit && (credit.rows.length > 0 || credit.error) && (
              <section className="credit">
                <div className="panel-head">
                  <h2>信用卡额度</h2>
                  {credit.utilization != null && <span className="num credit-total">已用 {percent(credit.utilization)}</span>}
                </div>
                {credit.error ? (
                  <div className="notice notice-bad">{credit.error}</div>
                ) : (
                  <div className="credit-list">
                    {credit.rows.map((row) => (
                      <CreditCard key={row.id} row={row} />
                    ))}
                  </div>
                )}
              </section>
            )}

            <section className="panel panel-list">
              <div className="panel-head">
                <h2>最近交易</h2>
                <a href="/journal" onClick={(e) => (e.preventDefault(), navigate(queryToUrl({})))}>
                  全部
                </a>
              </div>
              {!d.recent.length && <div className="panel-empty">账本里还没有交易</div>}
              {d.recent.map((t) => (
                <RecentRow key={t.id} t={t} currency={currency} />
              ))}
            </section>
          </>
        )}
      </div>

      <TabBar current="home" onTop={() => bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" })} onToast={onToast} />
    </div>
  );
}
