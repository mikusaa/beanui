import type { Kind, TxnSummary } from "./api";

const MINUS = "−";

/** 千分位，两位小数；负号用「−」。 */
export function money(value: string | number, sign: "auto" | "none" | "always" = "auto"): string {
  const n = typeof value === "number" ? value : Number(value);
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (sign === "none") return abs;
  if (n < 0) return MINUS + abs;
  return sign === "always" && n > 0 ? "+" + abs : abs;
}

/** 带「¥」的金额，负号放在「¥」前面。 */
export function yuan(value: string | number): string {
  const s = money(value);
  return s.startsWith(MINUS) ? MINUS + "¥" + s.slice(1) : "¥" + s;
}

/** 一位小数的百分比，负号同金额。 */
export function percent(value: number): string {
  return (value < 0 ? MINUS : "") + Math.abs(value).toFixed(1) + "%";
}

/** 支出「−」黑字，收入「+」绿字，转账不带符号。 */
/** 坐标轴刻度：「5千」「1.5万」，负数前面加「−」。 */
export function axisText(v: number): string {
  if (v < 0) return MINUS + axisText(-v);
  if (v >= 10000) return `${Number((v / 10000).toFixed(2))}万`;
  if (v >= 1000) return `${Number((v / 1000).toFixed(1))}千`;
  return String(v);
}

/** 刻度间隔取 1、2、2.5、5 乘 10 的幂，steps 格放得下 max。 */
export function niceStep(max: number, steps: number): number {
  const raw = Math.max(max, 1) / steps;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw)!;
}

export function txnAmount(t: Pick<TxnSummary, "kind" | "amount" | "currency">, operating: string) {
  const text = t.kind === "transfer" ? money(t.amount, "none") : money(t.amount, "always");
  const tone: Kind | "refund" = t.kind === "transfer" ? "transfer" : Number(t.amount) > 0 ? "income" : "expense";
  return { text: t.currency === operating ? text : `${text} ${t.currency}`, tone };
}

/** 流水行上的金额。按账户口径时写筛的那个资金科目的变动（带正负号），和收支口径的金额不一样时，
 *  own 写收支口径的那个数，如「支出 482.50」：平摊时是自己那份，有优惠时是原价。 */
export function rowAmount(t: Pick<TxnSummary, "kind" | "amount" | "currency" | "change">, operating: string) {
  const c = t.change;
  if (!c) return { ...txnAmount(t, operating), own: null };
  const text = money(c.amount, "always");
  const tone: Kind = t.kind === "transfer" ? "transfer" : Number(c.amount) > 0 ? "income" : "expense";
  const same = c.currency === t.currency && Number(c.amount) === Number(t.amount);
  const label = t.kind === "income" ? "收入" : Number(t.amount) > 0 ? "退款" : "支出";
  const own = t.kind === "transfer" || same ? null : `${label} ${money(t.amount, "none")}${t.currency === operating ? "" : ` ${t.currency}`}`;
  return { text: c.currency === operating ? text : `${text} ${c.currency}`, tone, own };
}

export function title(t: Pick<TxnSummary, "payee" | "narration">): string {
  return [t.payee, t.narration].filter(Boolean).join(" · ") || "（无摘要）";
}

/** 资金流向：「出钱的 → 进钱的」，只有一边时只写那边。 */
export function flow(t: TxnSummary): string {
  return t.sources.length && t.targets.length && t.kind !== "income"
    ? `${t.sources.join("、")} → ${t.targets.join("、")}`
    : (t.kind === "income" ? t.targets : t.sources).join("、") || t.targets.join("、");
}

/** 「分类 · 资金流向 · #标签」；车票把分类换成开车时间（退票写退票费）。 */
export function subtitle(t: TxnSummary, lead = t.category?.name ?? "转账"): string {
  return [lead, flow(t), ...t.tags.map((x) => `#${x}`)].filter(Boolean).join(" · ");
}

const thisYear = new Date().getFullYear();

export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return (y === thisYear ? "" : `${y} 年 `) + `${m} 月 ${d} 日`;
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return Number(y) === thisYear ? `${m}-${d}` : iso;
}

export function weekday(iso: string): string {
  return "周" + "日一二三四五六"[new Date(iso + "T00:00:00").getDay()];
}

export function firstChar(text: string): string {
  return Array.from(text.trim())[0] ?? "·";
}
