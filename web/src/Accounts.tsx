import { useEffect, useRef, useState, type ReactNode } from "react";
import { fetchAccounts, type AccountGroup, type AccountRow, type Accounts as AccountsData, type Custody, type Holding } from "./api";
import { money, yuan } from "./format";
import { queryToUrl } from "./journalState";
import { Mark } from "./Mark";
import { navigate } from "./router";
import { useDataVersion } from "./sync";
import { TabBar } from "./TabBar";

type Side = "assets" | "liabilities";
const SIDES: { key: Side; label: string }[] = [
  { key: "assets", label: "资产" },
  { key: "liabilities", label: "负债" },
];

// 分组图标照画布 Phone-Accounts，按科目第二段取；画布没有的（现金、分期）另配。电脑端资产负债表也用
export const GROUP_ICONS: Record<string, string> = {
  Bank: "M3 21h18M5 21V10M19 21V10M9 21v-7M15 21v-7M2 10l10-6 10 6z",
  Cash: "M2 7h20v10H2zM12 12h.01M6 12h.01M18 12h.01",
  Digital: "M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4v4M16 13h.01",
  Investments: "M3 17l6-6 4 4 8-8M15 7h6v6",
  Prepaid: "M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4z",
  Receivables: "M12 3v12M7 10l5 5 5-5M4 21h16",
  CreditCard: "M2 6h20v12H2zM2 10h20M6 15h4",
  Credit: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7v5l3 3",
  Installment: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7v5l3 3",
  Payables: "M12 21V9M7 14l5-5 5 5M4 3h16",
};
export const CUSTODY_ICON = "M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6z";
export const OTHER_ICON = "M5 12h.01M12 12h.01M19 12h.01";

// 账户多的分组（如十几张银行卡）只列前几个，其余收成一行；电脑端资产负债表同样
export const FOLD_OVER = 6;
export const FOLD_KEEP = 3;

/** 一万以上写成「¥12.2 万」。 */
function wan(value: string): string {
  const n = Number(value);
  return Math.abs(n) >= 10000 ? `${n < 0 ? "−" : ""}¥${(Math.abs(n) / 10000).toFixed(1)} 万` : yuan(n);
}

function units(h: { currency: string; units: string }): string {
  const n = Number(h.units);
  const text = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 8 });
  return `${n < 0 ? "−" : ""}${text} ${h.currency}`;
}

/** 主货币以外的持仓：换算过的只写数量，没有价格的放在后面，注明未计入。 */
export function holdingsText(holdings: Holding[]): string {
  const priced = holdings.filter((h) => h.value != null).map(units);
  const unpriced = holdings.filter((h) => h.value == null).map(units);
  return [...priced, ...(unpriced.length ? [`${unpriced.join("、")} 未计入`] : [])].join(" · ");
}

/** 账户行的金额；全是没有价格的持仓时金额没有意义，写「—」。 */
export function rowAmount(k: AccountRow): string {
  return k.holdings.length && k.holdings.every((h) => h.value == null) && !Number(k.amount) ? "—" : money(k.amount);
}

/** 近 12 个月净资产，最后一个点是今天。 */
function Trend({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const [w, h, pad] = [320, 56, 6];
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const x = (i: number) => 4 + (i / (points.length - 1)) * (w - 8);
  const y = (v: number) => (hi === lo ? h / 2 : h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2));
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = points.length - 1;
  return (
    <svg role="img" aria-label="近 12 个月净资产走势" viewBox={`0 0 ${w} ${h}`} className="nw-trend">
      <path d={d} fill="none" stroke="#ADC0FF" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(points[last])} r="4" fill="#FFFFFF" />
    </svg>
  );
}

function Row({ mark, name, sub, amount, href, onClick }: { mark: ReactNode; name: string; sub?: string; amount: string; href?: string; onClick: () => void }) {
  const body = (
    <>
      {mark}
      <span className="acct-text">
        <span className="acct-name">{name}</span>
        {sub && <span className="num acct-sub">{sub}</span>}
      </span>
      <span className="num acct-amount">{amount}</span>
    </>
  );
  return href ? (
    <a href={href} className="acct-row" onClick={(e) => (e.preventDefault(), onClick())}>
      {body}
    </a>
  ) : (
    <button type="button" className="acct-row" onClick={onClick}>
      {body}
    </button>
  );
}

function Group({ group, open, onToggle }: { group: AccountGroup; open: boolean; onToggle: () => void }) {
  const [unfolded, setUnfolded] = useState(false);
  const kids = group.children;
  const fold = !unfolded && kids.length > FOLD_OVER;
  const shown = fold ? kids.slice(0, FOLD_KEEP) : kids;
  const rest = kids.slice(FOLD_KEEP);

  return (
    <section className="acct-group">
      <button type="button" className="acct-head" aria-expanded={open} onClick={onToggle}>
        <span className="acct-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d={GROUP_ICONS[group.key] ?? OTHER_ICON} />
          </svg>
        </span>
        <span className="acct-group-name">{group.name}</span>
        <span className="num acct-group-amount">{money(group.amount)}</span>
        <span className="acct-chev" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div>
          {shown.map((k) => (
            <Row
              key={k.account}
              mark={<Mark brand={k.brand} fallback={k.name} size={24} radius={7} fontSize={12} />}
              name={k.name}
              sub={k.holdings.length ? holdingsText(k.holdings) : undefined}
              amount={rowAmount(k)}
              href={journalUrl(k.account)}
              onClick={() => navigate(journalUrl(k.account))}
            />
          ))}
          {fold && (
            <Row
              mark={<Mark brand={null} fallback="其他" size={24} radius={7} fontSize={12} />}
              name={`其他 ${rest.length} 个账户`}
              amount={money(rest.reduce((s, k) => s + Number(k.amount), 0))}
              onClick={() => setUnfolded(true)}
            />
          )}
        </div>
      )}
    </section>
  );
}

// 余额是从开户算起的，流水也看全部时间
export const journalUrl = (account: string) => queryToUrl({ account, time: "all" });

/** 替别人管的钱，不计入资产、负债两边的合计。每人一组：代管资金、代管款，以及两边是否相等。 */
function CustodyCard({ people }: { people: Custody[] }) {
  return (
    <section className="acct-group" aria-label="代管">
      <div className="acct-head">
        <span className="acct-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d={CUSTODY_ICON} />
          </svg>
        </span>
        <span className="acct-group-name">代管</span>
        <span className="custody-hint">不计入资产、负债合计</span>
      </div>
      {people.map((c) => {
        const diff = Number(c.diff);
        const kids = c.assets.children;
        return (
          <div key={c.key}>
            {[c.assets, c.liabilities].map((s) => (
              <Row
                key={s.account}
                mark={<Mark brand={s === c.assets && kids.length === 1 ? kids[0].brand : null} fallback={s.name} size={24} radius={7} fontSize={12} />}
                name={s.name}
                // 资金放在哪：只有一处且就是它本身时不用写
                sub={s === c.assets && kids.length && !(kids.length === 1 && kids[0].account === s.account) ? kids.map((k) => `${k.name} ${money(k.amount)}`).join(" · ") : undefined}
                amount={money(s.amount)}
                href={journalUrl(s.account)}
                onClick={() => navigate(journalUrl(s.account))}
              />
            ))}
            <div className={"custody-note" + (diff ? " is-warn" : "")}>
              {diff
                ? `代管资金比代管款${diff > 0 ? "多" : "少"} ${yuan(Math.abs(diff))}，可能收益或支出只记了一边；差额已计入净资产`
                : "两边相等，不影响净资产"}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** shown、active 的意思同流水页。 */
export function Accounts({ shown, active, onToast }: { shown: boolean; active: boolean; onToast: (msg: string) => void }) {
  const [side, setSide] = useState<Side>("assets");
  // 没点过的分组：每边第一组展开，其余收起
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [data, setData] = useState<AccountsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useDataVersion();
  const bodyRef = useRef<HTMLDivElement>(null);

  // 每次回到账户页都重新取一次，账本可能刚改过
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
  const change = d ? Number(d.change.amount) : 0;
  const groups = d?.sides[side] ?? [];
  // 代管两边不相等时，净资产 ≠ 资产 − 负债，要说明多出来的是什么
  const custodyDiff = d ? d.custody.reduce((s, c) => s + Number(c.diff), 0) : 0;

  return (
    <div className={"screen" + (shown ? "" : " is-hidden")} inert={!active}>
      <div className="home-body acct-body" ref={bodyRef}>
        <h1 className="page-title">账户</h1>

        {error && <div className="notice">加载失败：{error}</div>}
        {!d && !error && <div className="notice">加载中…</div>}

        {d && (
          <>
            <section className="hero-card nw-card">
              <div className="hero-main">
                <span className="hero-label">净资产</span>
                <span className="num hero-total nw-total">{yuan(d.net_worth)}</span>
                <span className="hero-label small">
                  <span className={"num hero-change " + (change > 0 ? "is-gain" : change < 0 ? "is-loss" : "")}>
                    {change > 0 ? "+" : ""}
                    {yuan(d.change.amount)}
                  </span>{" "}
                  较上月末
                </span>
                {Math.abs(custodyDiff) >= 0.005 && <span className="hero-label small">含代管两边的差额 {yuan(custodyDiff)}</span>}
                {d.unconverted.length > 0 && (
                  <span className="hero-label small">{d.unconverted.map((u) => u.currency).join("、")} 没有价格，未计入</span>
                )}
              </div>
              <Trend points={d.trend.map((p) => Number(p.net_worth))} />
            </section>

            <div className="segmented" role="tablist" aria-label="资产或负债">
              {SIDES.map((s) => (
                <button type="button" role="tab" key={s.key} aria-selected={side === s.key} className={side === s.key ? "is-on" : ""} onClick={() => setSide(s.key)}>
                  {s.label} <span className="num">{wan(d[s.key])}</span>
                </button>
              ))}
            </div>

            {!groups.length && <div className="notice">没有{side === "assets" ? "资产" : "负债"}</div>}
            {groups.map((g, i) => (
              <Group
                key={g.account}
                group={g}
                open={open[g.account] ?? i === 0}
                onToggle={() => setOpen((o) => ({ ...o, [g.account]: !(o[g.account] ?? i === 0) }))}
              />
            ))}
            {d.custody.length > 0 && <CustodyCard people={d.custody} />}
          </>
        )}
      </div>

      <TabBar current="accounts" onTop={() => bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" })} onToast={onToast} />
    </div>
  );
}
