import { useCallback, useRef, useState } from "react";
import type { IncomeGroup, IncomeRow } from "./api";
import { DeskCard, DeskPage } from "./DeskPage";
import { MonthlyChart } from "./DesktopOverview";
import { money, percent, yuan } from "./format";
import { CategoryTile } from "./icons";
import { categoryUrl, changeText, changeTone, childName, compareLabel, periodOptions, rangeLabel, savingsText, SIDES, useIncome, useIncomeRange, type Side } from "./Income";
import { RANGES } from "./Overview";
import { navigate } from "./router";
import { Sheet } from "./Sheet";

// 没点过的组：占这一边 10% 以上、又有子类的展开，同资产负债表
const OPEN_SHARE = 10;

/** 「2026 年 1 月 1 日 – 10 月 31 日」，同一年时后半截不写年。 */
function rangeText(start: string, end: string): string {
  const [y1, m1, d1] = start.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  const first = `${y1} 年 ${m1} 月 ${d1} 日`;
  return `${first} – ${y1 === y2 ? "" : `${y2} 年 `}${m2} 月 ${d2} 日`;
}

/** 图按卡片的实际宽度画，一个单位就是一像素：占满整行时不至于太高，1024 宽时字也不会缩小。
 *  返回给元素用的 ref（数据到了才挂上）和量到的宽度。 */
function useWidth(fallback: number): [(el: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(fallback);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    observer.current = new ResizeObserver(([e]) => e.contentRect.width > 0 && setWidth(Math.round(e.contentRect.width)));
    observer.current.observe(el);
  }, []);
  return [ref, width];
}

function Change({ row, side }: { row: IncomeRow; side: Side }) {
  if (row.change == null) return <span className="num inc-change" title={row.previous === "0.00" ? "上一段没有" : undefined}>—</span>;
  return (
    <span className={`num inc-change desk-change is-${changeTone(row.change, side)}`} title={`上一段 ${yuan(row.previous!)}`}>
      {changeText(row.change)}
    </span>
  );
}

function Group({ group, side, total, max, time, compare, open, onToggle }: { group: IncomeGroup; side: Side; total: number; max: number; time: string; compare: boolean; open: boolean; onToggle: () => void }) {
  const kids = group.children;
  const share = (v: string) => (total > 0 ? percent((Number(v) / total) * 100) : "");
  const go = (account: string) => navigate(categoryUrl(account, time));
  return (
    <>
      <button type="button" className="bal-group inc-row" aria-expanded={kids.length ? open : undefined} onClick={() => (kids.length ? onToggle() : go(group.account))}>
        <span className="bal-chev" aria-hidden="true">
          {kids.length > 0 && (open ? "▼" : "▶")}
        </span>
        <CategoryTile account={group.account} size={28} radius={8} iconSize={14} stroke={2.1} />
        <span className="bal-group-name">{group.name}</span>
        <span className="bar inc-bar" aria-hidden="true">
          <span className="bar-fill" style={{ width: `${max > 0 ? Math.max(0, (Number(group.amount) / max) * 100) : 0}%` }} />
        </span>
        <span className="num bal-share">{share(group.amount)}</span>
        {compare && <Change row={group} side={side} />}
        <span className="num bal-amount">{money(group.amount)}</span>
      </button>
      {open &&
        kids.map((k) => (
          <a key={k.account} href={categoryUrl(k.account, time)} className="bal-row inc-row inc-kid-row" onClick={(e) => (e.preventDefault(), go(k.account))}>
            <span className="bal-text">
              <span className="bal-name">{childName(k, group)}</span>
            </span>
            <span className="num bal-share">{share(k.amount)}</span>
            {compare && <Change row={k} side={side} />}
            <span className="num bal-amount">{money(k.amount)}</span>
          </a>
        ))}
    </>
  );
}

/** 电脑端收支表：画布上没有这一屏，照概览和资产负债表的样子。数据来自 /api/income，口径同首页。 */
export function DesktopIncome({ shown, active, search }: { shown: boolean; active: boolean; search: string | null }) {
  const [range, setRange] = useIncomeRange(search, active);
  const [d, error] = useIncome(range, active);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  const [chartRef, chartWidth] = useWidth(1000);

  const label = rangeLabel(range);
  const period = !RANGES.some((r) => r.value === range);
  const c = d?.compare;
  const vs = d ? compareLabel(range, d.capped) : "";
  const isOpen = (g: IncomeGroup, total: number) => open[g.account] ?? (g.children.length > 0 && total > 0 && (Number(g.amount) / total) * 100 >= OPEN_SHARE);

  const kpi = (s: Side) => {
    const change = s === "income" ? c?.income_change : c?.expense_change;
    return (
      <div className="desk-kpi" key={s}>
        <span className="desk-kpi-label">
          {label}
          {s === "income" ? "收入" : "支出"}
        </span>
        <span className="num desk-kpi-value">{yuan(d![s])}</span>
        {c && (
          <span className="desk-kpi-sub">
            {change == null ? (
              <>
                {vs.slice(1)}没有{s === "income" ? "收入" : "支出"}
              </>
            ) : (
              <>
                <span className={`num desk-change is-${changeTone(change, s)}`}>{changeText(change)}</span> {vs}
              </>
            )}
          </span>
        )}
      </div>
    );
  };

  const sideCard = (s: Side) => {
    const groups = d!.sides[s];
    const total = Number(d![s]);
    // 色条同概览的支出分类，最大的一组占满
    const max = Math.max(...groups.map((g) => Number(g.amount)), 0);
    const name = s === "income" ? "收入" : "支出";
    return (
      <DeskCard key={s} title={name} className="bal-card" extra={<span className="num bal-total">{yuan(d![s])}</span>}>
        {groups.length > 0 && (
          <div className="inc-cols" aria-hidden="true">
            <span>分类</span>
            <span className="bal-share">占比</span>
            {c && <span className="inc-change">{vs.slice(1)}</span>}
            <span className="bal-amount">金额</span>
          </div>
        )}
        {!groups.length && <div className="panel-empty">这段时间没有{name}</div>}
        {groups.map((g) => (
          <Group key={g.account} group={g} side={s} total={total} max={max} time={range} compare={c != null} open={isOpen(g, total)} onToggle={() => setOpen((o) => ({ ...o, [g.account]: !isOpen(g, total) }))} />
        ))}
      </DeskCard>
    );
  };

  return (
    <DeskPage
      shown={shown}
      active={active}
      title="收支表"
      subtitle={d ? `${rangeText(d.start, d.end)}${d.capped ? " · 只算到今天" : ""} · 只算 ${d.currency}` : " "}
      actions={
        <div className="desk-seg" role="group" aria-label="时间范围">
          {RANGES.map((x) => (
            <button type="button" key={x.value} className={x.value === range ? "is-on" : ""} aria-pressed={x.value === range} onClick={() => setRange(x.value)}>
              {x.label}
            </button>
          ))}
          <button type="button" ref={pickRef} className={period ? "is-on" : ""} aria-pressed={period} onClick={() => setAnchor(pickRef.current!.getBoundingClientRect())}>
            {period ? label : "选年月"} ▾
          </button>
        </div>
      }
    >
      {error && <div className="notice">加载失败：{error}</div>}
      {!d && !error && <div className="notice">加载中…</div>}

      {d && (
        <>
          <section className="desk-kpis" aria-label="关键指标">
            {kpi("income")}
            {kpi("expense")}
            <div className="desk-kpi">
              <span className="desk-kpi-label">结余</span>
              <span className="num desk-kpi-value">{yuan(d.net)}</span>
              <span className="desk-kpi-sub">
                {d.savings_rate != null && d.savings_rate >= -100 ? (
                  <>
                    储蓄率 <span className="num desk-strong">{percent(d.savings_rate)}</span>
                  </>
                ) : (
                  savingsText(d.savings_rate)
                )}
                {c?.savings_rate != null && c.savings_rate >= -100 && (
                  <>
                    {(d.savings_rate == null || d.savings_rate >= -100) && " · "}
                    {vs.slice(1)} <span className="num">{percent(c.savings_rate)}</span>
                  </>
                )}
              </span>
            </div>
          </section>

          <DeskCard
            title="月度收支"
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
                <span className="desk-card-note">点一个月看那个月</span>
              </span>
            }
          >
            <div ref={chartRef}>
              <MonthlyChart months={d.months} start={d.start} end={d.end} onPick={setRange} width={chartWidth} />
            </div>
          </DeskCard>

          <div className="bal-grid">{SIDES.slice().reverse().map((s) => sideCard(s.key))}</div>
        </>
      )}

      {anchor && (
        <Sheet
          title="选年月"
          options={periodOptions(d?.years)}
          value={period ? range : ""}
          clearable={false}
          anchor={anchor}
          onPick={(v) => (setRange(v), setAnchor(null))}
          onClose={() => setAnchor(null)}
        />
      )}
    </DeskPage>
  );
}
