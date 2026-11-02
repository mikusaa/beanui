import { useMemo, useState } from "react";
import type { Facets } from "./api";
import { CategoryTile } from "./icons";
import { SheetFrame } from "./Sheet";

// 流水的「分类」筛选：支出大类是图标格子，收入大类是文字按钮，选中的大类下面展开它的子类；搜索时退回列表。
// 大类是科目第二段（Expenses:Food），子类是第三段，更深的只能搜到。都按全部年份的笔数排，位置不跟着时间段跳。

const COLUMNS = 4;
const POP_WIDTH = 360;

type Node = { account: string; name: string; count: number };
type Group = Node & { children: Node[] };

const prefix = (account: string, depth: number) => account.split(":").slice(0, depth).join(":");
const under = (account: string, a: string) => account === a || account.startsWith(a + ":");
const byCount = (a: Node, b: Node) => b.count - a.count || a.account.localeCompare(b.account);

/** 把记过账的分类按大类、子类合起来，笔数加总（同一笔记在两个子类里会算两次，只用来排序）。 */
export function categoryGroups(facets: Facets): { expense: Group[]; income: Group[]; all: Node[] } {
  const name = (a: string) => facets.names[a] ?? a.split(":").pop()!;
  const groups = new Map<string, Group>();
  const all = new Map<string, Node>();
  for (const c of facets.categories) {
    const top = prefix(c.account, 2);
    let g = groups.get(top);
    if (!g) groups.set(top, (g = { account: top, name: name(top), count: 0, children: [] }));
    g.count += c.count;
    if (c.account.split(":").length > 2) {
      const mid = prefix(c.account, 3);
      let child = g.children.find((x) => x.account === mid);
      if (!child) g.children.push((child = { account: mid, name: name(mid), count: 0 }));
      child.count += c.count;
    }
    for (const a of [top, prefix(c.account, 3), c.account]) if (!all.has(a)) all.set(a, { account: a, name: name(a), count: 0 });
  }
  const sorted = [...groups.values()].sort(byCount);
  for (const g of sorted) g.children.sort(byCount);
  return {
    expense: sorted.filter((g) => g.account.startsWith("Expenses:")),
    income: sorted.filter((g) => g.account.startsWith("Income:")),
    all: [...all.values()].sort((a, b) => a.account.localeCompare(b.account)),
  };
}

export function CategorySheet({
  facets,
  value,
  onPick,
  onClose,
  anchor,
}: {
  facets: Facets | null;
  value: string;
  onPick: (v: string) => void;
  onClose: () => void;
  anchor?: DOMRect;
}) {
  const [filter, setFilter] = useState("");
  const groups = useMemo(() => facets && categoryGroups(facets), [facets]);
  const f = filter.trim().toLowerCase();
  const found = f && groups ? groups.all.filter((n) => n.name.toLowerCase().includes(f) || n.account.toLowerCase().includes(f)) : [];

  // 选中的子类那排：「全部X」加第三段；选的是更深的科目时点亮它所在的第三段
  const subs = (g: Group) =>
    g.children.length > 0 &&
    under(value, g.account) && (
      <div className="cat-subs" key={g.account + ":subs"}>
        <button type="button" className={"chip" + (value === g.account ? " is-on" : "")} onClick={() => onPick(g.account)}>
          全部{g.name}
        </button>
        {g.children.map((c) => (
          <button type="button" key={c.account} className={"chip" + (under(value, c.account) ? " is-on" : "")} onClick={() => onPick(c.account)}>
            {c.name}
          </button>
        ))}
      </div>
    );

  // 子类那排插在选中的格子所在那一行下面
  const grid = (gs: Group[]) => {
    const at = gs.findIndex((g) => under(value, g.account));
    const end = at < 0 ? -1 : Math.min(gs.length, Math.ceil((at + 1) / COLUMNS) * COLUMNS) - 1;
    return gs.flatMap((g, i) => [
      <button type="button" key={g.account} className={"cat-cell" + (i === at ? " is-on" : "")} aria-pressed={i === at} onClick={() => onPick(g.account)}>
        <CategoryTile account={g.account} size={44} radius={12} iconSize={22} />
        <span className="cat-cell-name">{g.name}</span>
      </button>,
      i === end ? subs(gs[at]) : null,
    ]);
  };

  return (
    <SheetFrame title="分类" onClose={onClose} onClear={value ? () => onPick("") : undefined} anchor={anchor} width={POP_WIDTH} className="cat-sheet">
      <input className="sheet-search" type="search" autoFocus={Boolean(anchor)} placeholder="搜分类名或科目" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="筛选分类" />
      <div className="sheet-list">
        {!groups && <div className="sheet-empty">加载中…</div>}
        {groups && f && !found.length && <div className="sheet-empty">没有匹配的分类</div>}
        {f
          ? found.map((n) => (
              <button type="button" key={n.account} className={"sheet-item" + (n.account === value ? " is-on" : "")} onClick={() => onPick(n.account)}>
                <span className="sheet-label">
                  <span>{n.name}</span>
                  <span className="sheet-hint mono">{n.account}</span>
                </span>
              </button>
            ))
          : groups && (
              <>
                {groups.expense.length > 0 && (
                  <>
                    <h3 className="cat-sec">支出</h3>
                    <div className="cat-grid">{grid(groups.expense)}</div>
                  </>
                )}
                {groups.income.length > 0 && (
                  <>
                    <h3 className="cat-sec">收入</h3>
                    <div className="cat-pills">
                      {groups.income.map((g) => (
                        <button type="button" key={g.account} className={"chip" + (under(value, g.account) ? " is-on" : "")} onClick={() => onPick(g.account)}>
                          {g.name}
                        </button>
                      ))}
                    </div>
                    {groups.income.map(subs)}
                  </>
                )}
              </>
            )}
      </div>
    </SheetFrame>
  );
}
