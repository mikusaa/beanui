import { useEffect, useRef } from "react";
import type { Directive, DirectiveDetail } from "./api";
import { money } from "./format";
import { Icon, type IconName } from "./icons";
import { Mark } from "./Mark";

// 流水里交易以外的指令：余额断言、开户和销户、备注、价格、文档。手机和电脑两版的行、详情里的条目都从这里取

const RED = "#B42318";
const COLORS = { balance: "#067647", open: "#175CD3", note: "#B54708", price: "#6941C6", document: "#475467" };

export type DirectiveView = {
  /** 类型名，开户那类按动作写「开户」或「销户」 */
  label: string;
  icon: IconName;
  color: string;
  title: string;
  sub: string;
  /** 右边那一栏：余额断言写结果，价格写价格，其余为空 */
  amount: string;
  tone: "income" | "transfer" | "bad";
};

/** 价格的小数位按账本原样，至少两位。 */
const priceText = (n: string) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });

export function directiveView(d: Directive, operating: string): DirectiveView {
  const unit = (c: string) => (c === operating ? "" : ` ${c}`);
  switch (d.type) {
    case "balance":
      return {
        label: "余额断言",
        icon: d.ok ? "check" : "cross",
        color: d.ok ? COLORS.balance : RED,
        title: `余额断言 · ${d.name}`,
        sub: `= ${money(d.amount)} ${d.currency}` + (d.ok ? "" : ` · 实际 ${money(d.actual)}`),
        amount: d.ok ? "✓ 通过" : "✗ 不符",
        tone: d.ok ? "income" : "bad",
      };
    case "open": {
      const label = d.action === "open" ? "开户" : "销户";
      return {
        label,
        icon: d.action,
        color: COLORS.open,
        title: `${label} · ${d.name}`,
        sub: [d.account, d.currencies.join("、")].filter(Boolean).join(" · "),
        amount: "",
        tone: "transfer",
      };
    }
    case "note":
      return { label: "备注", icon: "note", color: COLORS.note, title: `备注 · ${d.name}`, sub: d.comment, amount: "", tone: "transfer" };
    case "price":
      return {
        label: "价格",
        icon: "chart",
        color: COLORS.price,
        title: `价格 · ${d.name}`,
        sub: d.name === d.currency ? "每单位价格" : `${d.currency} 每单位价格`,
        amount: priceText(d.amount) + unit(d.quote),
        tone: "transfer",
      };
    case "document":
      return { label: "文档", icon: "file", color: COLORS.document, title: `文档 · ${d.name}`, sub: d.filename, amount: "", tone: "transfer" };
  }
}

/** 类型的小方块，样子同分类方块。 */
export function TypeTile({ view, size, radius, iconSize, stroke, className }: { view: DirectiveView; size: number; radius: number; iconSize: number; stroke?: number; className?: string }) {
  return (
    <span className={"cat-tile " + (className ?? "")} style={{ width: size, height: size, borderRadius: radius, ["--c" as string]: view.color }} aria-hidden="true">
      <Icon name={view.icon} size={iconSize} stroke={stroke} />
    </span>
  );
}

/** 类型标签，样子同电脑端的分类标签。 */
export function TypeTag({ view }: { view: DirectiveView }) {
  return (
    <span className="desk-tag-cat" style={{ ["--c" as string]: view.color }}>
      <Icon name={view.icon} size={13} stroke={2.2} />
      {view.label}
    </span>
  );
}

const href = (d: Directive) => `/txn/${encodeURIComponent(d.id)}`;

/** 手机流水里的一行，样子同交易：徽标、类型角标、标题、说明、右边的结果。 */
export function DirectiveRow({ d, currency, onOpen }: { d: Directive; currency: string; onOpen: (d: Directive) => void }) {
  const v = directiveView(d, currency);
  return (
    <a href={href(d)} className="row" onClick={(e) => (e.preventDefault(), onOpen(d))}>
      <span className="row-mark">
        <Mark brand={d.brand} fallback={d.name} size={40} radius={12} fontSize={16} />
        <TypeTile view={v} size={20} radius={10} iconSize={11} stroke={2.6} className="badge" />
      </span>
      <span className="row-text">
        <span className="row-title">{v.title}</span>
        <span className="row-sub">{v.sub}</span>
      </span>
      <span className={`num amount tone-${v.tone}`}>{v.amount}</span>
    </a>
  );
}

/** 电脑流水里的一行，对应画布里余额断言那一行。 */
export function DeskDirectiveRow({ d, currency, on, onPick }: { d: Directive; currency: string; on: boolean; onPick: (d: Directive) => void }) {
  const v = directiveView(d, currency);
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (on) ref.current?.scrollIntoView({ block: "nearest" });
  }, [on]);
  return (
    <a
      ref={ref}
      href={href(d)}
      className={"desk-row" + (on ? " is-on" : "")}
      aria-current={on || undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        onPick(d);
      }}
    >
      <Mark brand={d.brand} fallback={d.name} size={38} radius={11} fontSize={16} />
      <span className="desk-txn-text">
        <span className="desk-txn-title">{v.title}</span>
        <span className="desk-txn-sub">
          <TypeTag view={v} />
          <span className="desk-directive-sub">{v.sub}</span>
        </span>
      </span>
      <span className={`num amount desk-row-amount tone-${v.tone}`}>{v.amount}</span>
    </a>
  );
}

/** 详情里按类型列的条目：[标题, 内容, 是否等宽]。 */
export function directiveFacts(d: Directive): [string, string, boolean?][] {
  const account: [string, string, boolean?][] = d.account ? [["科目", d.account, true]] : [];
  const tags = (t: string[]): [string, string][] => [["标签", t.length ? t.map((x) => `#${x}`).join(" ") : "—"]];
  switch (d.type) {
    case "balance":
      return [
        ...account,
        ["断言", `${money(d.amount)} ${d.currency}`],
        ["实际", `${money(d.actual)} ${d.currency}`],
        ["结果", d.ok ? "通过" : `不符，差 ${money(d.diff ?? "0", "always")} ${d.currency}`],
      ];
    case "open":
      return [...account, ["币种", d.currencies.join("、") || "不限"]];
    case "note":
      return [...account, ["内容", d.comment], ...tags(d.tags)];
    case "price":
      return [
        ["商品", d.name === d.currency ? d.currency : `${d.name}（${d.currency}）`],
        ["价格", `${priceText(d.amount)} ${d.quote}`],
      ];
    case "document":
      return [...account, ["文件", d.path, true], ...tags(d.tags)];
  }
}

/** 给 AI 会话的修改请求：文件、行号和这条指令的要点。 */
export function directiveCopyText(d: DirectiveDetail): string {
  const v = directiveView(d, "");
  const what = d.type === "balance" ? `${d.name} = ${money(d.amount)} ${d.currency}` : d.type === "price" ? `${d.currency} ${d.amount} ${d.quote}` : [d.name, v.sub].filter(Boolean).join(" · ");
  return `请修改 ${d.source.file} 第 ${d.source.line} 行这条${v.label}（${d.date} ${what}）：`;
}
