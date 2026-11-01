import { useEffect, useRef, useState } from "react";
import { fetchIncome, type Income as IncomeData, type IncomeGroup, type IncomeRow } from "./api";
import { money, percent, yuan } from "./format";
import { CategoryTile } from "./icons";
import { queryToUrl } from "./journalState";
import { RANGES } from "./Overview";
import { navigate } from "./router";
import { Sheet, type Option } from "./Sheet";
import { useDataVersion } from "./sync";
import { TabBar } from "./TabBar";

// 收支表的时间：首页的五个范围，加上「选年月」挑的某一年（2025）或某个月（2025-03）。默认今年
const DEFAULT_RANGE = "year";
const PERIOD = /^\d{4}(-(0[1-9]|1[0-2]))?$/;

export type Side = "expense" | "income";
export const SIDES: { key: Side; label: string }[] = [
  { key: "expense", label: "支出" },
  { key: "income", label: "收入" },
];

// 从别的标签切回收支表时保留时间范围
let lastUrl = "/income";
export const incomeUrl = (time?: string) => (time == null ? lastUrl : time === DEFAULT_RANGE ? "/income" : `/income?time=${time}`);

function rangeFromUrl(search: string): string {
  const t = new URLSearchParams(search).get("time") ?? "";
  return RANGES.some((r) => r.value === t) || PERIOD.test(t) ? t : DEFAULT_RANGE;
}

/** 「今年」「2025 年」「2025 年 3 月」 */
export function rangeLabel(time: string): string {
  const r = RANGES.find((x) => x.value === time);
  if (r) return r.label;
  const [y, m] = time.split("-");
  return m ? `${y} 年 ${Number(m)} 月` : `${y} 年`;
}

/** 和哪一段比：「较上月同期」「较前一年」。截在今天的（今年、本月）和上一段同期比，过完的和前一整段比。 */
export function compareLabel(time: string, capped: boolean): string {
  const r = RANGES.find((x) => x.value === time);
  if (r) return r.compare;
  const month = time.includes("-");
  if (capped) return month ? "较上月同期" : "较去年同期";
  return month ? "较前一月" : "较前一年";
}

/** 「选年月」的选项：有交易的年份，每年下面是那年到今天为止的月份，新的在前。 */
export function periodOptions(years: number[] | undefined): Option[] | null {
  if (!years) return null;
  const now = new Date();
  return years.flatMap((y) => {
    const last = y === now.getFullYear() ? now.getMonth() + 1 : 12;
    const months = Array.from({ length: last }, (_, i) => last - i).map((m) => ({ value: `${y}-${String(m).padStart(2, "0")}`, label: `${y} 年 ${m} 月` }));
    return [{ value: String(y), label: `${y} 年` }, ...months];
  });
}

/** 时间范围跟着地址走，同首页的 useRange；手机和电脑的收支表共用。 */
export function useIncomeRange(search: string | null, active: boolean): [string, (range: string) => void] {
  const [range, setRange] = useState(() => rangeFromUrl(search ?? ""));

  useEffect(() => {
    if (search != null) setRange(rangeFromUrl(search));
  }, [search]);

  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    lastUrl = incomeUrl(range);
    if (activeRef.current) history.replaceState(history.state, "", lastUrl);
  }, [range]);

  return [range, setRange];
}

/** 每次回到收支表都重新取一次，账本可能刚改过；切范围时先留着旧数据，不闪成「加载中」。 */
export function useIncome(range: string, active: boolean): [IncomeData | null, string | null] {
  const [data, setData] = useState<IncomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useDataVersion();
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    setError(null);
    fetchIncome(range, ctrl.signal)
      .then(setData)
      .catch((e) => ctrl.signal.aborted || setError(e.message));
    return () => ctrl.abort();
  }, [range, active, version]);
  return [data, error];
}

/** 变化的箭头和百分比；支出涨了是坏事，收入涨了是好事。 */
export function changeTone(change: number, side: Side): "good" | "bad" | "flat" {
  if (change === 0) return "flat";
  return change > 0 === (side === "income") ? "good" : "bad";
}

export function changeText(change: number): string {
  return change === 0 ? "持平" : `${change > 0 ? "↑" : "↓"} ${percent(Math.abs(change))}`;
}

/** 储蓄率同首页：低于 −100% 时不写（结余照常写），没有收入时说明为什么没有。 */
export function savingsText(rate: number | null): string {
  if (rate == null) return "没有收入，不算储蓄率";
  return rate >= -100 ? `储蓄率 ${percent(rate)}` : "";
}

/** 点一类进流水：同一段时间、这个分类。 */
export const categoryUrl = (account: string, time: string) => queryToUrl({ category: account, time });

/** 直接记在组科目本身、没有再细分的那一类。 */
export const childName = (row: IncomeRow, group: IncomeGroup) => (row.account === group.account ? "未细分" : row.name);

function GroupRow({ group, total, max, time, open, onToggle }: { group: IncomeGroup; total: number; max: number; time: string; open: boolean; onToggle: () => void }) {
  const amount = Number(group.amount);
  const kids = group.children;
  return (
    <div className="inc-group">
      <button
        type="button"
        className="cat-row"
        aria-expanded={kids.length ? open : undefined}
        onClick={() => (kids.length ? onToggle() : navigate(categoryUrl(group.account, time)))}
      >
        <span className="cat-line">
          <span className="cat-name">
            <CategoryTile account={group.account} size={24} radius={7} iconSize={13} stroke={2.2} />
            {group.name}
            {kids.length > 0 && (
              <span className="inc-chev" aria-hidden="true">
                {open ? "▾" : "▸"}
              </span>
            )}
          </span>
          <span className="num cat-amount">{yuan(group.amount)}</span>
          <span className="num inc-share">{total > 0 ? percent((amount / total) * 100) : ""}</span>
        </span>
        <span className="bar" aria-hidden="true">
          <span className="bar-fill" style={{ width: `${max > 0 ? Math.max(0, (amount / max) * 100) : 0}%` }} />
        </span>
      </button>
      {open && kids.length > 0 && (
        <div className="inc-kids">
          {kids.map((k) => (
            <a
              key={k.account}
              href={categoryUrl(k.account, time)}
              className="inc-kid"
              onClick={(e) => (e.preventDefault(), navigate(categoryUrl(k.account, time)))}
            >
              <span className="inc-kid-name">{childName(k, group)}</span>
              <span className="num">{money(k.amount)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** 手机收支表：结余卡、支出和收入切换的分类列表。shown、active、search 的意思同流水页。 */
export function Income({ shown, active, search, onToast }: { shown: boolean; active: boolean; search: string | null; onToast: (msg: string) => void }) {
  const [range, setRange] = useIncomeRange(search, active);
  const [d, error] = useIncome(range, active);
  const [side, setSide] = useState<Side>("expense");
  // 没点过的组：每边第一组展开
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [picking, setPicking] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<HTMLButtonElement>(null);

  const label = rangeLabel(range);
  const period = !RANGES.some((r) => r.value === range);
  // 选了某年某月后，那个 chip 排在最右边，滚过去让它看得见
  useEffect(() => {
    if (period && shown) pickRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [period, range, shown]);
  const groups = d?.sides[side] ?? [];
  const total = Number(d?.[side] ?? 0);
  const max = Math.max(...groups.map((g) => Number(g.amount)), 0);
  const c = d?.compare;
  const vs = d ? compareLabel(range, d.capped) : "";

  const tile = (s: Side) => {
    const change = s === "income" ? c?.income_change : c?.expense_change;
    return (
      <div className="hero-tile">
        <span className="hero-label small">
          {s === "income" ? "收入" : "支出"}
          {change != null && (
            <>
              {" · "}
              <span className={"num hero-change " + (changeTone(change, s) === "good" ? "is-gain" : changeTone(change, s) === "bad" ? "is-loss" : "")}>{changeText(change)}</span>
            </>
          )}
        </span>
        <span className="num hero-tile-value">{yuan(d![s])}</span>
      </div>
    );
  };

  return (
    <div className={"screen" + (shown ? "" : " is-hidden")} inert={!active}>
      <div className="home-body acct-body" ref={bodyRef}>
        <h1 className="page-title">收支表</h1>

        <div className="chips" role="group" aria-label="时间范围">
          {RANGES.map((x) => (
            <button type="button" key={x.value} className={"chip chip-range" + (x.value === range ? " is-on" : "")} aria-pressed={x.value === range} onClick={() => setRange(x.value)}>
              {x.label}
            </button>
          ))}
          <button type="button" ref={pickRef} className={"chip chip-range" + (period ? " is-on" : "")} aria-pressed={period} onClick={() => setPicking(true)}>
            {period ? label : "选年月"} ▾
          </button>
        </div>

        {error && <div className="notice">加载失败：{error}</div>}
        {!d && !error && <div className="notice">加载中…</div>}

        {d && (
          <>
            <section className="hero-card">
              <div className="hero-main">
                <span className="hero-label">{label}结余</span>
                <span className="num hero-total">{yuan(d.net)}</span>
                <span className="hero-label small">
                  {[savingsText(d.savings_rate), c?.savings_rate != null && c.savings_rate >= -100 && `${vs.slice(1)} ${percent(c.savings_rate)}`].filter(Boolean).join(" · ")}
                </span>
              </div>
              <div className="hero-tiles">
                {tile("income")}
                {tile("expense")}
              </div>
            </section>

            <section className="panel">
              <div className="segmented" role="tablist" aria-label="支出或收入">
                {SIDES.map((s) => (
                  <button type="button" role="tab" key={s.key} aria-selected={side === s.key} className={side === s.key ? "is-on" : ""} onClick={() => setSide(s.key)}>
                    {s.label} <span className="num">{d.sides[s.key].length} 类</span>
                  </button>
                ))}
              </div>
              {!groups.length && <div className="panel-empty">这段时间没有{side === "income" ? "收入" : "支出"}</div>}
              {groups.map((g, i) => (
                <GroupRow
                  key={g.account}
                  group={g}
                  total={total}
                  max={max}
                  time={range}
                  open={open[g.account] ?? i === 0}
                  onToggle={() => setOpen((o) => ({ ...o, [g.account]: !(o[g.account] ?? i === 0) }))}
                />
              ))}
              {c && (
                <span className="inc-foot">
                  {vs.slice(1)}：收入 {yuan(c.income)} · 支出 {yuan(c.expense)}
                </span>
              )}
            </section>
          </>
        )}
      </div>

      {picking && (
        <Sheet
          title="选年月"
          options={periodOptions(d?.years)}
          value={period ? range : ""}
          clearable={false}
          onPick={(v) => (setRange(v), setPicking(false))}
          onClose={() => setPicking(false)}
        />
      )}

      <TabBar current="income" onTop={() => bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" })} onToast={onToast} />
    </div>
  );
}
