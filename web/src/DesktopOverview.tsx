import { useEffect, useState } from "react";
import { fetchAccounts, fetchOverview, type Accounts, type Overview, type TxnSummary } from "./api";
import { CategoryTag, DeskCard, DeskPage, FundList } from "./DeskPage";
import { axisText, money, niceStep, percent, shortDate, txnAmount, yuan } from "./format";
import { CategoryTile } from "./icons";
import { incomeUrl } from "./Income";
import { queryToUrl } from "./journalState";
import { Mark } from "./Mark";
import { RANGES, useRange } from "./Overview";
import { navigate } from "./router";
import { useDataVersion } from "./sync";

// 画布 Main 列出 8 类支出、8 笔最近交易
const TOP_CATEGORIES = 8;
const RECENT = 8;

/** 「2026 年 10 月 1 日 – 10 月 31 日」，同一年时后半截不写年。 */
function rangeText(start: string, end: string): string {
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  const first = `${y1} 年 ${m1} 月 ${d1} 日`;
  if (start === end) return first;
  return `${first} – ${y1 === y2 ? "" : `${y2} 年 `}${m2} 月 ${d2} 日`;
}

/** 近 12 个月收支柱状图，落在当前时间范围里的月份标亮；点一个月进那个月的流水（收支表里是切到那个月）。
 *  width 是画布宽度，高度固定，占满整行的图（收支表）给宽一些，免得太高。 */
export function MonthlyChart({ months, start, end, onPick, width = 640 }: { months: Overview["months"]; start: string; end: string; onPick?: (month: string) => void; width?: number }) {
  const [w, top, base, left, steps] = [width, 20, 180, 40, 4];
  const step = niceStep(Math.max(...months.map((m) => Math.max(Number(m.income), Number(m.expense)))), steps);
  const y = (v: number) => base - (Math.max(0, v) / (step * steps)) * (base - top);
  const slot = (w - left) / months.length;
  const bar = 12;
  const last = months[months.length - 1];
  return (
    <svg role="img" aria-label={`近 ${months.length} 个月收入与支出柱状图，${Number(last.month.slice(5))} 月支出 ${money(last.expense)} 元`} viewBox={`0 0 ${w} 210`} className="chart">
      {Array.from({ length: steps + 1 }, (_, i) => {
        const yy = base - (i * (base - top)) / steps;
        return (
          <g key={i}>
            <line x1={left} x2={w} y1={yy} y2={yy} className={i ? "chart-grid" : "chart-base"} />
            <text x={32} y={yy + 4} textAnchor="end" className="chart-label">
              {axisText(i * step)}
            </text>
          </g>
        );
      })}
      {months.map((m, i) => {
        const x = left + slot * i + (slot - bar * 2 - 2) / 2;
        const on = m.month >= start.slice(0, 7) && m.month <= end.slice(0, 7);
        const [inc, exp] = [Number(m.income), Number(m.expense)];
        const h = (v: number) => (v > 0 ? Math.max(1, base - y(v)) : 0);
        return (
          <g key={m.month} className="chart-month" onClick={() => (onPick ? onPick(m.month) : navigate(queryToUrl({ time: m.month })))}>
            <title>{`${m.month.replace("-", " 年 ")} 月 · 收入 ¥${money(inc)} · 支出 ¥${money(exp)}`}</title>
            <rect x={left + slot * i} y={top} width={slot} height={base - top + 24} className="chart-hit" />
            <rect x={x} y={base - h(inc)} width={bar} height={h(inc)} rx="2" className="chart-income" />
            <rect x={x + bar + 2} y={base - h(exp)} width={bar} height={h(exp)} rx="2" className={"chart-expense" + (on ? " is-on" : "")} />
            <text x={left + slot * i + slot / 2} y={200} textAnchor="middle" className={"chart-label" + (on ? " is-on" : "")}>
              {Number(m.month.slice(5))}月
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function RecentRow({ t, currency }: { t: TxnSummary; currency: string }) {
  const amt = txnAmount(t, currency);
  const href = `/txn/${encodeURIComponent(t.id)}`;
  return (
    <a href={href} className="desk-txn" onClick={(e) => (e.preventDefault(), navigate(href))}>
      <span className="num desk-txn-date">{shortDate(t.date)}</span>
      <Mark brand={t.brand} fallback={t.payee || t.narration} size={34} radius={10} fontSize={15} />
      <span className="desk-txn-text">
        <span className="desk-txn-title">
          {t.flag === "!" && <span className="flag">待确认</span>}
          {t.payee && t.narration ? (
            <>
              {t.payee} <span className="desk-txn-narration">· {t.narration}</span>
            </>
          ) : (
            t.payee || t.narration || "（无摘要）"
          )}
        </span>
        <span className="desk-txn-sub">
          <CategoryTag category={t.category} />
          <FundList t={t} />
        </span>
      </span>
      <span className={`num amount tone-${amt.tone}`}>{amt.text}</span>
    </a>
  );
}

/** 电脑端概览，对应画布 Main。数据来自 /api/overview（收支、分类、额度、最近交易）和 /api/accounts（净资产）。 */
export function DesktopOverview({ shown, active, onToast, search }: { shown: boolean; active: boolean; search: string | null; onToast: (msg: string) => void }) {
  const [range, setRange] = useRange(search, active);
  const [data, setData] = useState<Overview | null>(null);
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const version = useDataVersion();
  const [error, setError] = useState<string | null>(null);
  const [allCats, setAllCats] = useState(false);

  // 每次回到概览都重新取一次，账本可能刚改过
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    setError(null);
    fetchOverview(range, ctrl.signal, RECENT)
      .then(setData)
      .catch((e) => ctrl.signal.aborted || setError(e.message));
    return () => ctrl.abort();
  }, [range, active, version]);

  // 净资产不随时间范围变
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    fetchAccounts(ctrl.signal)
      .then(setAccounts)
      .catch(() => ctrl.signal.aborted || setAccounts(null));
    return () => ctrl.abort();
  }, [active, version]);

  const r = RANGES.find((x) => x.value === range)!;
  const d = data; // 切范围时先留着旧数据，不闪成「加载中」
  const currency = d?.currency ?? "CNY";
  const cats = d?.categories ?? [];
  const shownCats = allCats ? cats : cats.slice(0, TOP_CATEGORIES);
  const maxCat = Math.max(...cats.map((c) => Number(c.amount)), 0);
  const change = d?.compare?.change;
  const credit = d?.credit;
  const nwChange = accounts ? Number(accounts.change.amount) : 0;
  const toJournal = (q: Parameters<typeof queryToUrl>[0]) => navigate(queryToUrl({ time: range, ...q }));

  return (
    <DeskPage
      shown={shown}
      active={active}
      title="概览"
      subtitle={d ? rangeText(d.start, d.end) : " "}
      actions={
        <div className="desk-seg" role="group" aria-label="时间范围">
          {RANGES.map((x) => (
            <button type="button" key={x.value} className={x.value === range ? "is-on" : ""} aria-pressed={x.value === range} onClick={() => setRange(x.value)}>
              {x.label}
            </button>
          ))}
        </div>
      }
    >
      {error && <div className="notice">加载失败：{error}</div>}
      {!d && !error && <div className="notice">加载中…</div>}

      {d && (
        <>
          <section className="desk-kpis" aria-label="关键指标">
            <div className="desk-kpi">
              <span className="desk-kpi-label">{r.label}支出</span>
              <span className="num desk-kpi-value">{yuan(d.expense)}</span>
              {d.compare && (
                <span className="desk-kpi-sub">
                  {change == null ? (
                    <>{r.compare.slice(1)}没有支出</>
                  ) : (
                    <>
                      <span className={"num desk-change " + (change > 0 ? "is-bad" : "is-good")}>{change === 0 ? "持平" : `${change > 0 ? "↑" : "↓"} ${percent(Math.abs(change))}`}</span> {r.compare}
                    </>
                  )}
                </span>
              )}
            </div>
            <div className="desk-kpi">
              <span className="desk-kpi-label">{r.label}收入</span>
              <span className="num desk-kpi-value">{yuan(d.income)}</span>
              <span className="desk-kpi-sub">
                {d.savings_rate != null && d.savings_rate >= -100 ? (
                  <>
                    储蓄率 <span className="num desk-strong">{percent(d.savings_rate)}</span>
                  </>
                ) : (
                  <>
                    结余 <span className="num desk-strong">{yuan(d.net)}</span>
                  </>
                )}
              </span>
            </div>
            <a href="/accounts" className="desk-kpi" onClick={(e) => (e.preventDefault(), navigate("/accounts"))}>
              <span className="desk-kpi-label">净资产</span>
              <span className="num desk-kpi-value">{accounts ? yuan(accounts.net_worth) : "—"}</span>
              {accounts && (
                <span className="desk-kpi-sub">
                  <span className={"num desk-change " + (nwChange > 0 ? "is-good" : nwChange < 0 ? "is-bad" : "")}>
                    {nwChange > 0 ? "+" : ""}
                    {yuan(accounts.change.amount)}
                  </span>{" "}
                  较上月末
                </span>
              )}
            </a>
            {credit && (credit.rows.length > 0 || credit.error) && (
              <div className="desk-kpi">
                <span className="desk-kpi-label">信用卡已用</span>
                <span className="num desk-kpi-value">{credit.used != null ? yuan(credit.used) : "—"}</span>
                {credit.error ? (
                  <span className="desk-kpi-sub notice-bad">额度配置有误</span>
                ) : credit.utilization != null && credit.limit != null ? (
                  <span className="desk-meter">
                    <span className="bar" role="progressbar" aria-label="信用卡额度使用率" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, credit.utilization))}>
                      <span className={`bar-fill level-${credit.level}`} style={{ width: `${Math.max(0, Math.min(100, credit.utilization))}%` }} />
                    </span>
                    <span className="num desk-kpi-sub">
                      {percent(credit.utilization)} / {yuan(credit.limit).replace(/\.00$/, "")}
                    </span>
                  </span>
                ) : (
                  <span className="desk-kpi-sub">未设置额度</span>
                )}
              </div>
            )}
          </section>

          <div className="desk-grid">
            <DeskCard
              title="近 12 个月收支"
              extra={
                <span className="chart-legend">
                  <span>
                    <i className="chart-key chart-income" aria-hidden="true" />
                    收入
                  </span>
                  <span>
                    <i className="chart-key chart-expense" aria-hidden="true" />
                    支出
                  </span>
                </span>
              }
            >
              <MonthlyChart months={d.months} start={d.start} end={d.end} />
            </DeskCard>

            <DeskCard
              title={`${r.label}支出分类`}
              className="desk-cats"
              extra={
                <a href={incomeUrl(range)} onClick={(e) => (e.preventDefault(), navigate(incomeUrl(range)))}>
                  收支表 →
                </a>
              }
            >
              {!cats.length && <div className="panel-empty">这段时间没有支出</div>}
              {shownCats.map((c) => (
                <button type="button" key={c.account} className="desk-cat" onClick={() => toJournal({ category: c.account })}>
                  <span className="desk-cat-name">
                    <CategoryTile account={c.account} size={26} radius={8} iconSize={14} stroke={2.1} />
                    {c.name}
                  </span>
                  <span className="bar desk-cat-bar" aria-hidden="true">
                    <span className="bar-fill" style={{ width: `${maxCat ? (Number(c.amount) / maxCat) * 100 : 0}%` }} />
                  </span>
                  <span className="num desk-cat-amount">{yuan(c.amount)}</span>
                </button>
              ))}
              {cats.length > TOP_CATEGORIES && (
                <button type="button" className="link-btn desk-more" onClick={() => setAllCats((v) => !v)}>
                  {allCats ? "收起" : `还有 ${cats.length - TOP_CATEGORIES} 类`}
                </button>
              )}
            </DeskCard>
          </div>

          <div className="desk-grid">
            {credit && (credit.rows.length > 0 || credit.error) && (
              <DeskCard title={`${currency === "CNY" ? "人民币" : currency + " "}卡额度`} extra={<span className="desk-card-note">截至 {Number(credit.as_of.slice(5, 7))} 月 {Number(credit.as_of.slice(8))} 日</span>}>
                {credit.error ? (
                  <div className="notice notice-bad">{credit.error}</div>
                ) : (
                  <div className="desk-table-wrap">
                    <table className="desk-table">
                      <thead>
                        <tr>
                          <th scope="col">银行</th>
                          <th scope="col">额度</th>
                          <th scope="col">已用</th>
                          <th scope="col">可用</th>
                          <th scope="col" className="desk-col-meter">
                            使用率
                          </th>
                        </tr>
                      </thead>
                      <tbody className="num">
                        {credit.rows.map((k) => {
                          const pct = k.utilization == null ? null : Math.max(0, Math.min(100, k.utilization));
                          return (
                            <tr key={k.id}>
                              <td>
                                <span className="desk-bank">
                                  <Mark brand={k.brand} fallback={k.bank} size={24} radius={7} fontSize={12} />
                                  <span className="desk-bank-name">{k.bank}</span>
                                  {k.cards != null && <span className="desk-card-note">{k.cards} 张</span>}
                                </span>
                              </td>
                              <td>{k.limit != null ? yuan(k.limit).replace(/\.00$/, "") : "—"}</td>
                              <td>{yuan(k.used)}</td>
                              <td>{k.available != null ? yuan(k.available) : "—"}</td>
                              <td className="desk-col-meter">
                                <span className="desk-meter">
                                  <span className="bar bar-thin" aria-hidden="true">
                                    {pct != null && <span className={`bar-fill level-${k.level}`} style={{ width: `${pct}%` }} />}
                                  </span>
                                  <span className="desk-pct">{k.utilization == null ? "—" : percent(k.utilization)}</span>
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </DeskCard>
            )}

            <DeskCard
              title="最近交易"
              className="desk-recent"
              extra={
                <a href="/journal" onClick={(e) => (e.preventDefault(), navigate(queryToUrl({})))}>
                  全部流水 →
                </a>
              }
            >
              {!d.recent.length && <div className="panel-empty">账本里还没有交易</div>}
              {d.recent.map((t) => (
                <RecentRow key={t.id} t={t} currency={currency} />
              ))}
            </DeskCard>
          </div>
        </>
      )}
    </DeskPage>
  );
}
