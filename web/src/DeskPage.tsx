import type { ReactNode, RefObject } from "react";
import type { Category, Fund, TxnSummary } from "./api";
import { categoryStyle, Icon } from "./icons";
import { Mark } from "./Mark";

/** 电脑端一屏的外框：标题、副标题、右边的操作按钮，下面是内容。画布 Main、Desktop-Journal、Desktop-Balance 的
 *  主区都是这个样子；shown、active 的意思同手机各屏。没有电脑版的屏照旧用手机版，在主区居中成一列。
 *  bodyRef、onScroll 给要接着加载的屏（流水）用，主区就是滚动的那个元素。 */
export function DeskPage({
  shown,
  active,
  title,
  subtitle,
  actions,
  bodyRef,
  onScroll,
  children,
}: {
  shown: boolean;
  active: boolean;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  bodyRef?: RefObject<HTMLElement | null>;
  onScroll?: () => void;
  children: ReactNode;
}) {
  return (
    <div className={"screen screen-desk" + (shown ? "" : " is-hidden")} inert={!active}>
      <main className="desk-body" ref={bodyRef} onScroll={onScroll}>
        <header className="desk-head">
          <div className="desk-title">
            <h1>{title}</h1>
            {subtitle && <span className="num">{subtitle}</span>}
          </div>
          {actions}
        </header>
        {children}
      </main>
    </div>
  );
}

/** 白底圆角卡片，标题在左上，右边可以放链接。 */
export function DeskCard({ title, extra, className, children }: { title?: string; extra?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={"desk-card" + (className ? " " + className : "")}>
      {title && (
        <div className="desk-card-head">
          <h2>{title}</h2>
          {extra}
        </div>
      )}
      {children}
    </section>
  );
}

/** 分类小标签：图标加分类名，转账没有分类。 */
export function CategoryTag({ category }: { category: Category | null }) {
  const cat = categoryStyle(category?.account);
  return (
    <span className="desk-tag-cat" style={{ ["--c" as string]: cat.color }}>
      <Icon name={cat.icon} size={13} stroke={2.2} />
      {category?.name ?? "转账"}
    </span>
  );
}

/** 交易用到的资金科目，名字前带账户徽标。 */
export function FundList({ t }: { t: TxnSummary }) {
  const { sources, targets } = t.funds;
  // 支出看从哪出的钱，收入看进了哪，转账两头都写
  const groups: Fund[][] = t.kind === "transfer" ? [sources, targets] : t.kind === "income" ? [targets] : [sources.length ? sources : targets];
  return groups
    .filter((g) => g.length)
    .flatMap((g, i) =>
      g.map((f, j) => (
        <span key={`${i}-${f.account}`} className="desk-fund">
          {i > 0 && j === 0 && "→"}
          <Mark brand={f.brand} fallback={f.name} size={16} radius={5} fontSize={10} />
          {f.name}
        </span>
      )),
    );
}
