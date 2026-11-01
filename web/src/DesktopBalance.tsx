import { useEffect, useState } from "react";
import { CUSTODY_ICON, FOLD_KEEP, FOLD_OVER, GROUP_ICONS, holdingsText, journalUrl, OTHER_ICON, rowAmount } from "./Accounts";
import { fetchAccounts, type AccountGroup, type Accounts, type Brand, type Custody } from "./api";
import { DeskCard, DeskPage } from "./DeskPage";
import { axisText, money, niceStep, percent, yuan } from "./format";
import { Mark } from "./Mark";
import { navigate } from "./router";
import { useDataVersion } from "./sync";

type Side = "assets" | "liabilities";
const SIDES: { key: Side; label: string }[] = [
  { key: "assets", label: "资产" },
  { key: "liabilities", label: "负债" },
];

// 没点过的分组：占这一边 10% 以上的展开，零碎的收起（画布里银行、投资、信用卡展开，钱包、预付、应收等收起）
const OPEN_SHARE = 10;

// 点过的分组记在浏览器里，下次照样显示：{分组科目: 是否展开}。读不到（隐私窗口、清了数据）就退回上面的规则
const OPEN_KEY = "beanui.balance.open";

function loadOpen(): Record<string, boolean> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter(([, v]) => typeof v === "boolean"));
  } catch {
    return {};
  }
}

function saveOpen(open: Record<string, boolean>) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  } catch {
    // 存不了就只在这次打开里有效
  }
}

/** 「2026 年 10 月 31 日」 */
function dateText(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y} 年 ${m} 月 ${d} 日`;
}

/** 近 12 个月每月底的净资产，最后一个点是今天；悬停看每个点的金额。 */
function NetWorthChart({ trend }: { trend: Accounts["trend"] }) {
  const [w, h, top, base, left] = [640, 150, 20, 120, 40];
  const values = trend.map((p) => Number(p.net_worth));
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // 纵轴不从零起，三格左右放得下最高和最低
  const step = niceStep(hi - lo, 3);
  const floor = Math.floor(lo / step) * step;
  const ceil = Math.max(Math.ceil(hi / step) * step, floor + step);
  const ticks = Array.from({ length: Math.round((ceil - floor) / step) + 1 }, (_, i) => floor + i * step);
  const x = (i: number) => left + (i / (values.length - 1)) * (w - left - 10);
  const y = (v: number) => base - ((v - floor) / (ceil - floor)) * (base - top);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;
  const mid = Math.floor(last / 2);
  const slot = (w - left - 10) / last;
  return (
    <svg role="img" aria-label={`近 12 个月净资产走势，从 ${yuan(values[0])} 到 ${yuan(values[last])}`} viewBox={`0 0 ${w} ${h}`} className="chart bal-chart">
      {ticks.map((t, i) => (
        <g key={t}>
          <line x1={left} x2={w} y1={y(t)} y2={y(t)} className={i ? "chart-grid" : "chart-base"} />
          <text x={32} y={y(t) + 4} textAnchor="end" className="chart-label">
            {axisText(t)}
          </text>
        </g>
      ))}
      <path d={`${line} L${x(last).toFixed(1)} ${base} L${left} ${base} Z`} className="bal-area" />
      <path d={line} className="bal-line" />
      <circle cx={x(last)} cy={y(values[last])} r="4.5" className="bal-dot" />
      {[0, mid, last].map((i) => (
        <text key={i} x={i === last ? w : x(i)} y={142} textAnchor={i === last ? "end" : "middle"} className="chart-label">
          {trend[i].date.slice(0, 7)}
        </text>
      ))}
      {trend.map((p, i) => (
        <rect key={p.date} x={x(i) - slot / 2} y={top} width={slot} height={base - top} className="chart-hit">
          <title>{`${i === last ? "今天" : `${Number(p.date.slice(0, 4))} 年 ${Number(p.date.slice(5, 7))} 月底`} · ${yuan(p.net_worth)}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** 一个账户一行：徽标、名字，下面是科目（合并了子科目的写「:*」）和外币持仓。点了进这个账户的流水。 */
function Leaf({ brand, name, account, merged, note, amount, flat }: { brand: Brand | null; name: string; account: string; merged: boolean; note?: string; amount: string; flat?: boolean }) {
  const href = journalUrl(account);
  return (
    <a href={href} className={"bal-row" + (flat ? " is-flat" : "")} onClick={(e) => (e.preventDefault(), navigate(href))}>
      <Mark brand={brand} fallback={name} size={24} radius={7} fontSize={12} />
      <span className="bal-text">
        <span className="bal-name">{name}</span>
        <span className="bal-sub" title={note}>
          <span className="mono">
            {account}
            {merged && ":*"}
          </span>
          {note && <span className="num"> · {note}</span>}
        </span>
      </span>
      <span className="num bal-amount">{amount}</span>
    </a>
  );
}

function Group({ group, total, open, onToggle }: { group: AccountGroup; total: number; open: boolean; onToggle: () => void }) {
  const [unfolded, setUnfolded] = useState(false);
  const kids = group.children;
  const fold = !unfolded && kids.length > FOLD_OVER;
  const shown = fold ? kids.slice(0, FOLD_KEEP) : kids;
  const rest = kids.slice(FOLD_KEEP);
  return (
    <>
      <button type="button" className="bal-group" aria-expanded={open} onClick={onToggle}>
        <span className="bal-chev" aria-hidden="true">
          {open ? "▼" : "▶"}
        </span>
        <span className="acct-icon bal-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d={GROUP_ICONS[group.key] ?? OTHER_ICON} />
          </svg>
        </span>
        <span className="bal-group-name">{group.name}</span>
        <span className="num bal-share">{total > 0 ? percent((Number(group.amount) / total) * 100) : ""}</span>
        <span className="num bal-amount">{money(group.amount)}</span>
      </button>
      {open && (
        <>
          {shown.map((k) => (
            <Leaf key={k.account} brand={k.brand} name={k.name} account={k.account} merged={k.merged} note={k.holdings.length ? holdingsText(k.holdings) : undefined} amount={rowAmount(k)} />
          ))}
          {fold && (
            <button type="button" className="bal-row" onClick={() => setUnfolded(true)}>
              <Mark brand={null} fallback="其他" size={24} radius={7} fontSize={12} />
              <span className="bal-text">
                <span className="bal-name">其他 {rest.length} 个账户</span>
                <span className="bal-sub mono">{group.account}:*</span>
              </span>
              <span className="num bal-amount">{money(rest.reduce((s, k) => s + Number(k.amount), 0))}</span>
            </button>
          )}
        </>
      )}
    </>
  );
}

/** 替别人管的钱，不计入资产、负债两边的合计；每人写代管资金、代管款和两边是否相等，同手机账户页。 */
function CustodyCard({ people }: { people: Custody[] }) {
  return (
    <DeskCard
      title="代管"
      className="bal-card"
      extra={
        <span className="bal-hint">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={CUSTODY_ICON} />
          </svg>
          不计入资产、负债合计
        </span>
      }
    >
      {people.map((c) => {
        const diff = Number(c.diff);
        const kids = c.assets.children;
        const itself = kids.length === 1 && kids[0].account === c.assets.account;
        return (
          <div key={c.key} className="bal-person">
            <Leaf
              flat
              brand={kids.length === 1 ? kids[0].brand : null}
              name={c.assets.name}
              account={c.assets.account}
              merged={kids.length > 0 && !itself}
              // 资金放在哪：只有一处且就是它本身时不用写
              note={kids.length && !itself ? kids.map((k) => `${k.name} ${money(k.amount)}`).join(" · ") : undefined}
              amount={money(c.assets.amount)}
            />
            <Leaf flat brand={null} name={c.liabilities.name} account={c.liabilities.account} merged={false} amount={money(c.liabilities.amount)} />
            <div className={"custody-note bal-note" + (diff ? " is-warn" : "")}>
              {diff ? `代管资金比代管款${diff > 0 ? "多" : "少"} ${yuan(Math.abs(diff))}，可能收益或支出只记了一边；差额已计入净资产` : "两边相等，不影响净资产"}
            </div>
          </div>
        );
      })}
    </DeskCard>
  );
}

/** 电脑端资产负债表，对应画布 Desktop-Balance；数据和手机账户页同一个接口 /api/accounts，口径一样。 */
export function DesktopBalance({ shown, active }: { shown: boolean; active: boolean }) {
  const [data, setData] = useState<Accounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useDataVersion();
  const [open, setOpenState] = useState(loadOpen);
  // 合并进已存的，账本里暂时没有的分组也不丢
  const setOpen = (change: Record<string, boolean>) =>
    setOpenState((o) => {
      const next = { ...o, ...change };
      saveOpen(next);
      return next;
    });

  // 每次回到这一屏都重新取一次，账本可能刚改过
  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    setError(null);
    fetchAccounts(ctrl.signal)
      .then(setData)
      .catch((e) => ctrl.signal.aborted || setError(e.message));
    return () => ctrl.abort();
  }, [active, version]);

  const d = data;
  const totals = { assets: Number(d?.assets ?? 0), liabilities: Number(d?.liabilities ?? 0) };
  const isOpen = (side: Side, g: AccountGroup) => open[g.account] ?? (totals[side] > 0 && (Number(g.amount) / totals[side]) * 100 >= OPEN_SHARE);
  const all = d ? SIDES.flatMap((s) => d.sides[s.key].map((g) => ({ side: s.key, g }))) : [];
  const allOpen = all.length > 0 && all.every(({ side, g }) => isOpen(side, g));

  const change = d ? Number(d.change.amount) : 0;
  const custodyDiff = d ? d.custody.reduce((s, c) => s + Number(c.diff), 0) : 0;

  const sideCard = (s: (typeof SIDES)[number]) => (
    <DeskCard key={s.key} title={s.label} className="bal-card" extra={<span className="num bal-total">{yuan(d![s.key])}</span>}>
      {!d!.sides[s.key].length && <div className="panel-empty">没有{s.label}</div>}
      {d!.sides[s.key].map((g) => (
        <Group key={g.account} group={g} total={totals[s.key]} open={isOpen(s.key, g)} onToggle={() => setOpen({ [g.account]: !isOpen(s.key, g) })} />
      ))}
    </DeskCard>
  );

  return (
    <DeskPage
      shown={shown}
      active={active}
      title="资产负债表"
      subtitle={d ? `截至 ${dateText(d.as_of)} · 按 ${d.currency} 折算` : " "}
      actions={
        d && (
          <button type="button" className="bal-tool" onClick={() => setOpen(Object.fromEntries(all.map(({ g }) => [g.account, !allOpen])))}>
            {allOpen ? "全部收起" : "全部展开"}
          </button>
        )
      }
    >
      {error && <div className="notice">加载失败：{error}</div>}
      {!d && !error && <div className="notice">加载中…</div>}

      {d && (
        <>
          <section className="desk-card bal-hero">
            <div className="bal-hero-text">
              <div className="bal-hero-main">
                <span className="desk-kpi-label">净资产</span>
                <span className="num bal-net">{yuan(d.net_worth)}</span>
                <span className="desk-kpi-sub">
                  {/* 和概览、手机账户页一样只写较上月末的金额；近 12 个月的走势看走势图 */}
                  <span className={"num desk-change " + (change > 0 ? "is-good" : change < 0 ? "is-bad" : "")}>
                    {change > 0 ? "+" : ""}
                    {yuan(d.change.amount)}
                  </span>{" "}
                  较上月末
                </span>
                {Math.abs(custodyDiff) >= 0.005 && <span className="desk-kpi-sub">含代管两边的差额 {yuan(custodyDiff)}</span>}
                {d.unconverted.length > 0 && <span className="desk-kpi-sub">{d.unconverted.map((u) => u.currency).join("、")} 没有价格，未计入</span>}
              </div>
              <div className="bal-hero-sides">
                {SIDES.map((s) => (
                  <div key={s.key}>
                    <span className="desk-card-note">{s.label}</span>
                    <span className="num desk-strong">{yuan(d[s.key])}</span>
                  </div>
                ))}
              </div>
            </div>
            <NetWorthChart trend={d.trend} />
          </section>

          <div className="bal-grid">
            {sideCard(SIDES[0])}
            {/* 负债一般比资产短，代管接在负债下面；窄到一列时依次是资产、负债、代管 */}
            <div className="bal-col">
              {sideCard(SIDES[1])}
              {d.custody.length > 0 && <CustodyCard people={d.custody} />}
            </div>
          </div>
        </>
      )}
    </DeskPage>
  );
}
