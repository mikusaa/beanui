import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { ENTRY_TYPES, fetchFacets, fetchJournal, type Day, type EntryType, type Facets, type FutureGroup, type Journal, type JournalQuery } from "./api";
import { money } from "./format";
import type { Option } from "./Sheet";
import { useDataVersion } from "./sync";

// 手机流水和电脑流水共用：筛选跟着地址走、搜索停顿再查、分页接着加载、筛选面板的选项和标签文字

export const TIMES: Option[] = [
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
  { value: "last-month", label: "上月" },
  { value: "3months", label: "近三月" },
  { value: "year", label: "今年" },
];

export type FilterKey = "time" | "account" | "category" | "tag" | "payee";
export const FILTER_TITLES: Record<FilterKey, string> = { time: "时间", account: "账户", category: "分类", tag: "标签", payee: "收付方" };
export const FILTER_KEYS = Object.keys(FILTER_TITLES) as FilterKey[];

export const EMPTY_QUERY: JournalQuery = { time: "month", q: "", account: "", category: "", tag: "", payee: "" };

export function queryFromUrl(search: string): JournalQuery {
  const p = new URLSearchParams(search);
  return Object.fromEntries(Object.entries(EMPTY_QUERY).map(([k, v]) => [k, p.get(k) ?? v])) as JournalQuery;
}

/** 筛选写成地址；path 默认流水页，电脑端开着详情栏时是 /txn/<id>，筛选跟在后面。 */
export function queryToUrl(q: Partial<JournalQuery>, path = "/journal"): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v && v !== EMPTY_QUERY[k as keyof JournalQuery]) p.set(k, v);
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

const sameQuery = (a: JournalQuery, b: JournalQuery) => queryToUrl(a) === queryToUrl(b);

// 从别的标签切回流水时带上次的筛选；电脑侧栏的搜索框也跟着显示当前的关键词
let lastQuery = EMPTY_QUERY;
const listeners = new Set<() => void>();
export const journalUrl = () => queryToUrl(lastQuery);
export const useLastJournalQuery = () =>
  useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => lastQuery,
  );

export const TYPE_LABELS: Record<EntryType, string> = { txn: "交易", balance: "余额断言", open: "开户", note: "备注", price: "价格", document: "文档" };

// 流水显示哪些类型：默认交易和余额断言；改过就记在这台设备上，不进地址
const TYPES_KEY = "beanui.journal.types";
export const DEFAULT_TYPES: EntryType[] = ["txn", "balance"];

function readTypes(): EntryType[] {
  try {
    const saved = JSON.parse(localStorage.getItem(TYPES_KEY) ?? "null");
    if (Array.isArray(saved)) return ENTRY_TYPES.filter((t) => saved.includes(t));
  } catch {
    /* 读不到就用默认 */
  }
  return DEFAULT_TYPES;
}

let lastTypes: EntryType[] | null = null;

/** 开关的标签：类型名加筛选后的条数（不含预记）。 */
export const typeOptions = (counts: Journal["types"] | undefined): Option[] =>
  ENTRY_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t], count: counts?.[t] }));

/** 分页接口按笔数切，同一天可能跨两页，拼起来。 */
function mergeDays(a: Day[], b: Day[]): Day[] {
  if (!a.length || !b.length || a[a.length - 1].date !== b[0].date) return [...a, ...b];
  const last = a[a.length - 1];
  return [...a.slice(0, -1), { ...last, items: [...last.items, ...b[0].items] }, ...b.slice(1)];
}

/** 按账户口径时的「流出 X · 流入 Y」，为零的不写。 */
function changeTotal(c: { in: string; out: string }): string {
  return [Number(c.out) && `流出 ${money(c.out)}`, Number(c.in) && `流入 ${money(c.in)}`].filter(Boolean).join(" · ");
}

export function dayTotal(d: Pick<Day, "expense" | "income" | "transfer" | "change">): string {
  if (d.change) return changeTotal(d.change);
  const parts = [];
  if (Number(d.expense)) parts.push(`支出 ${money(d.expense)}`);
  if (Number(d.income)) parts.push(`收入 ${money(d.income)}`);
  if (!parts.length && Number(d.transfer)) parts.push(`转账 ${money(d.transfer)}`);
  return parts.join(" · ");
}

/** 预记组标题的合计：不像日分组那样只在没有收支时才写转账，不为零的都写，分期出账才看得见 */
export function futureTotal(f: FutureGroup): string {
  if (f.change) return changeTotal(f.change);
  return [
    Number(f.expense) && `支出 ${money(f.expense)}`,
    Number(f.income) && `收入 ${money(f.income)}`,
    Number(f.transfer) && `转账 ${money(f.transfer)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** 流水头上的「128 条 · 支出 ¥… · 收入 ¥…」；按账户口径时换成这个账户的流出、流入，币种不是主货币时写在后面。 */
export function journalSummary(j: Journal): string {
  const count = `${j.count.toLocaleString("en-US")} 条`;
  const m = j.measure;
  if (!m) return `${count} · 支出 ¥${money(j.expense)} · 收入 ¥${money(j.income)}`;
  const amt = (v: string) => (m.currency === j.currency ? `¥${money(v)}` : `${money(v)} ${m.currency}`);
  return `${count} · 流出 ${amt(m.out)} · 流入 ${amt(m.in)}`;
}

/** 预记组标题里日期以外的部分：「28 笔 · 最晚 2027-09-28」；合计另用 futureTotal。 */
export const futureLabel = (f: FutureGroup) => `${f.count} 笔 · 最晚 ${f.last}`;

// 预记组默认收起；展开后切标签、进出详情、窄屏宽屏之间切换都保持，换筛选、搜索词或刷新页面时收起
let lastFutureOpen = false;

/** 流水一屏的状态。search：地址里的查询串，null 表示地址不归流水管（被盖住或在别的屏）；
 *  listRef 是滚动的那个元素，换筛选时回到顶部、快到底时接着加载；searchRef 是搜索框，带 #search 进来时聚焦。 */
export function useJournal({
  search,
  active,
  onToast,
  listRef,
  searchRef,
}: {
  search: string | null;
  active: boolean;
  onToast: (msg: string) => void;
  listRef: RefObject<HTMLElement | null>;
  searchRef?: RefObject<HTMLInputElement | null>;
}) {
  // 地址不归流水管时（如窄屏和宽屏之间切换时正开着详情）接着用上次的筛选
  const [query, setQuery] = useState<JournalQuery>(() => (search != null ? queryFromUrl(search) : lastQuery));
  const [typed, setTyped] = useState(query.q);
  const [data, setData] = useState<Journal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sheet, setSheet] = useState<FilterKey | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [futureOpen, setFutureOpenState] = useState(lastFutureOpen);
  const [types, setTypesState] = useState<EntryType[]>(() => (lastTypes ??= readTypes()));
  const version = useDataVersion();
  const setFutureOpen = useCallback((open: boolean) => {
    lastFutureOpen = open;
    setFutureOpenState(open);
  }, []);

  /** 开或关一种类型；全关时留着交易，免得列表空掉。 */
  const toggleType = useCallback((t: EntryType) => {
    setTypesState((cur) => {
      const next = ENTRY_TYPES.filter((x) => (x === t ? !cur.includes(x) : cur.includes(x)));
      const kept = next.length ? next : (["txn"] as EntryType[]);
      lastTypes = kept;
      try {
        localStorage.setItem(TYPES_KEY, JSON.stringify(kept));
      } catch {
        /* 存不了就只在这次打开时有效 */
      }
      return kept;
    });
  }, []);

  // 搜索框停顿 250ms 再查
  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => (q.q === typed ? q : { ...q, q: typed })), 250);
    return () => clearTimeout(t);
  }, [typed]);

  // 从概览点分类、切标签、前进后退进来时，按地址里的筛选来
  useEffect(() => {
    if (search == null) return;
    const q = queryFromUrl(search);
    setQuery((cur) => (sameQuery(cur, q) ? cur : q));
    setTyped(q.q);
    // 概览的搜索按钮带着 #search 进来
    if (location.hash === "#search") {
      searchRef?.current?.focus();
      history.replaceState(history.state, "", location.pathname + location.search);
    }
  }, [search, searchRef]);

  // 只在筛选变了时改地址；刚切进来时地址是对的，用旧筛选去改会和上面那段来回打架。
  // 电脑端开着详情栏时地址是 /txn/<id>，筛选接在它后面
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    // 重新挂上时 query 就是 lastQuery，不算换筛选
    if (!sameQuery(lastQuery, query)) setFutureOpen(false);
    lastQuery = query;
    listeners.forEach((cb) => cb());
    if (activeRef.current) {
      const path = location.pathname.startsWith("/txn/") ? location.pathname : "/journal";
      history.replaceState(history.state, "", queryToUrl(query, path));
    }
  }, [query, setFutureOpen]);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    fetchJournal(query, types, 0, ctrl.signal)
      .then((d) => {
        setData(d);
        listRef.current?.scrollTo({ top: 0 });
      })
      .catch((e) => ctrl.signal.aborted || setError(e.message));
    return () => ctrl.abort();
  }, [query, types, listRef, version]);

  // 带着科目或分类进来时（如从账户页点进来），筛选标签要用中文名，不等打开筛选面板就取；取不到时标签退回末段
  const named = Boolean(query.account || query.category);
  useEffect(() => {
    if (named && !facets) fetchFacets().then(setFacets).catch(() => {});
  }, [named, facets]);

  const loadMore = useCallback(() => {
    if (!data?.next || loadingMore) return;
    setLoadingMore(true);
    fetchJournal(query, types, data.next)
      .then((more) => setData((d) => d && { ...more, days: mergeDays(d.days, more.days) }))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingMore(false));
  }, [data, query, types, loadingMore]);

  // 离底部不到两屏就接着加载
  const onScroll = () => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight * 2) loadMore();
  };

  const openSheet = (key: FilterKey) => {
    setSheet(key);
    if (!facets) fetchFacets().then(setFacets).catch((e) => onToast(e.message));
  };

  const options = (key: FilterKey): Option[] | null => {
    if (key === "time") {
      const years = (facets?.years ?? []).filter((y) => y !== new Date().getFullYear());
      return [...TIMES, ...years.map((y) => ({ value: String(y), label: `${y} 年` })), { value: "all", label: "全部" }];
    }
    if (!facets) return null;
    if (key === "account" || key === "category") {
      return facets[key === "account" ? "accounts" : "categories"].map((a) => ({ value: a.account, label: a.name, hint: a.account, count: a.count }));
    }
    if (key === "tag") return facets.tags.map((t) => ({ value: t.tag, label: `#${t.tag}`, count: t.count }));
    return facets.payees.map((p) => ({ value: p.payee, label: p.payee, count: p.count }));
  };

  const chipLabel = (key: FilterKey): string => {
    const v = query[key];
    if (key === "time") return TIMES.find((t) => t.value === v)?.label ?? (v === "all" ? "全部" : /^\d{4}$/.test(v) ? `${v} 年` : v);
    if (!v) return FILTER_TITLES[key];
    if (key === "tag") return `#${v}`;
    if (key === "account" || key === "category") {
      // 从账户页点进来的可能是没记过账的父科目（如信用卡按银行合并），不在 accounts 里
      const name = (a: string) => facets?.names[a] ?? a.split(":").pop()!;
      // 分类面板只列到第三段，更深的（数码·设备·手机）带上上一级，免得只看到「手机」
      return key === "category" && v.split(":").length > 3 ? `${name(v.split(":").slice(0, -1).join(":"))}·${name(v)}` : name(v);
    }
    return v;
  };

  const pick = (key: FilterKey, value: string) => {
    setQuery((q) => ({ ...q, [key]: value || EMPTY_QUERY[key] }));
    setSheet(null);
  };

  /** 清掉搜索词，电脑端的关键词标签上的 × 用。 */
  const clearSearch = () => {
    setTyped("");
    setQuery((q) => ({ ...q, q: "" }));
  };

  return { query, typed, setTyped, data, error, loadingMore, onScroll, sheet, setSheet, openSheet, facets, options, chipLabel, pick, clearSearch, futureOpen, setFutureOpen, types, toggleType };
}
