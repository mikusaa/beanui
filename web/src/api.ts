/** fit：mark 是贴边的裸标志，放进白底时四周留白；tile 是自带底色或已留白的图，原样铺满。 */
export type Brand = { id: string; name: string; logo: string | null; fit: "mark" | "tile" };
export type Category = { account: string; name: string; group: string };
export type Kind = "expense" | "income" | "transfer";
/** 资金科目：出钱或进钱的账户。 */
export type Fund = { account: string; name: string; brand: Brand | null };

export type TxnSummary = {
  id: string;
  date: string;
  type: "txn";
  flag: string;
  payee: string;
  narration: string;
  tags: string[];
  kind: Kind;
  amount: string;
  currency: string;
  category: Category | null;
  sources: string[];
  targets: string[];
  funds: { sources: Fund[]; targets: Fund[] };
  brand: Brand | null;
};

/** 流水里能显示的指令类型，次序同界面上的开关；open 含销户。 */
export const ENTRY_TYPES = ["txn", "balance", "open", "note", "price", "document"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/** 交易以外的指令。name 是科目的中文名，价格是商品名。 */
type DirectiveBase = { id: string; date: string; account: string | null; name: string; brand: Brand | null };
export type Directive = DirectiveBase &
  (
    | { type: "balance"; amount: string; currency: string; ok: boolean; diff: string | null; actual: string }
    | { type: "open"; action: "open" | "close"; currencies: string[] }
    | { type: "note"; comment: string; tags: string[] }
    | { type: "price"; currency: string; amount: string; quote: string }
    | { type: "document"; filename: string; path: string; tags: string[] }
  );

export type Entry = TxnSummary | Directive;

export type Day = {
  date: string;
  weekday: string;
  expense: string;
  income: string;
  transfer: string;
  items: Entry[];
};

/** 日期在今天以后的交易（预记的分期、订阅），一次给全，不计入流水的笔数和合计。 */
export type FutureGroup = {
  count: number;
  expense: string;
  income: string;
  transfer: string;
  first: string;
  last: string;
  days: Day[];
};

export type Journal = {
  count: number;
  currency: string;
  expense: string;
  income: string;
  /** 筛选后各类型的条数（不含预记），不管开关开没开。 */
  types: Record<EntryType, number>;
  days: Day[];
  next: number | null;
  future: FutureGroup | null;
};

export type Posting = {
  account: string;
  name: string;
  amount: string | null;
  currency: string | null;
  group: string | null;
  brand: Brand | null;
};

type Source = { source: { file: string; line: number; text: string }; commit: { hash: string; time: number | null } | null };

export type TxnDetail = TxnSummary &
  Source & {
    postings: Posting[];
    balanced: boolean;
    others: TxnSummary[];
  };

export type DirectiveDetail = Directive & Source;

export type Facets = {
  years: number[];
  accounts: { account: string; name: string; count: number }[];
  categories: { account: string; name: string; count: number }[];
  tags: { tag: string; count: number }[];
  payees: { payee: string; count: number }[];
  names: Record<string, string>;
};

// can_sync：NAS 上设了 SYNC_DIR，可以手动同步；pending：请求还没被 git-sync 取走
export type Sync = { state: "ok" | "error"; time: string; commit: string | null; message: string | null; can_sync: boolean; pending: boolean };

export type CreditRow = {
  id: string;
  bank: string;
  cards: number | null;
  limit: string | null;
  used: string;
  available: string | null;
  utilization: number | null;
  level: "ok" | "warn" | "high" | "over" | null;
  brand: Brand | null;
};

export type Overview = {
  title: string | null;
  currency: string;
  time: string;
  start: string;
  end: string;
  expense: string;
  income: string;
  net: string;
  savings_rate: number | null;
  compare: { start: string; end: string; expense: string; change: number | null } | null;
  categories: (Category & { amount: string })[];
  /** 近 12 个月，从早到晚，最后一个月只算到今天。 */
  months: { month: string; income: string; expense: string }[];
  credit: {
    as_of: string;
    rows: CreditRow[];
    error: string | null;
    utilization: number | null;
    level: CreditRow["level"];
    limit: string | null;
    used: string | null;
  };
  recent: TxnSummary[];
  sync: Sync | null;
};

/** 收支表的一类：previous 是上一段同期的金额，没有可比的上一段时为空；change 是变化的百分比，上一段为零时为空。 */
export type IncomeRow = { account: string; name: string; amount: string; previous: string | null; change: number | null };

/** 按科目第二段分的组；children 是前三段的分类，只记在组科目本身时为空。 */
export type IncomeGroup = IncomeRow & { group: string; children: IncomeRow[] };

export type Income = {
  currency: string;
  time: string;
  start: string;
  end: string;
  /** 范围截在了今天（本月、今年这类没过完的），比较时和上一段同期比。 */
  capped: boolean;
  income: string;
  expense: string;
  net: string;
  savings_rate: number | null;
  compare: {
    start: string;
    end: string;
    income: string;
    expense: string;
    net: string;
    savings_rate: number | null;
    income_change: number | null;
    expense_change: number | null;
  } | null;
  sides: { income: IncomeGroup[]; expense: IncomeGroup[] };
  /** 到所选范围最后一个月为止的 12 个月。 */
  months: Overview["months"];
  years: number[];
};

export type Holding = { currency: string; units: string; value: string | null };

/** merged：这一行合并了下面的子科目。 */
export type AccountRow = { account: string; name: string; amount: string; holdings: Holding[]; brand: Brand | null; merged: boolean };

export type AccountGroup = { account: string; key: string; name: string; amount: string; children: AccountRow[] };

export type CustodySide = { account: string; name: string; amount: string };

/** 替一个人管的钱：代管资金（资产）、代管款（负债，欠款为正）、差额 = 资金 − 代管款。 */
export type Custody = {
  key: string;
  assets: CustodySide & { children: (CustodySide & { brand: Brand | null })[] };
  liabilities: CustodySide;
  diff: string;
};

export type Accounts = {
  currency: string;
  as_of: string;
  net_worth: string;
  assets: string;
  liabilities: string;
  change: { since: string; amount: string };
  trend: { date: string; net_worth: string }[];
  unconverted: { currency: string; units: string }[];
  sides: { assets: AccountGroup[]; liabilities: AccountGroup[] };
  custody: Custody[];
};

export type JournalQuery = { time: string; q: string; account: string; category: string; tag: string; payee: string };

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, { signal });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.detail ?? `请求失败（${r.status}）`);
  }
  return r.json();
}

export function fetchJournal(query: JournalQuery, types: readonly EntryType[], offset: number, signal?: AbortSignal) {
  const p = new URLSearchParams({ time: query.time, offset: String(offset), limit: "150" });
  for (const t of types) p.append("type", t);
  if (query.q.trim()) p.set("q", query.q.trim());
  // 账户和分类都按科目前缀筛选，两个都选时都要满足
  if (query.account) p.append("account", query.account);
  if (query.category) p.append("account", query.category);
  if (query.tag) p.set("tag", query.tag);
  if (query.payee) p.set("payee", query.payee);
  return get<Journal>(`/api/journal?${p}`, signal);
}

/** 交易或流水里其他指令的详情，按 type 区分。 */
export const fetchTxn = (id: string, signal?: AbortSignal) => get<TxnDetail | DirectiveDetail>(`/api/txn/${encodeURIComponent(id)}`, signal);
export const fetchFacets = () => get<Facets>("/api/facets");
export const fetchOverview = (time: string, signal?: AbortSignal, recent = 5) =>
  get<Overview>(`/api/overview?${new URLSearchParams({ time, recent: String(recent) })}`, signal);
export const fetchIncome = (time: string, signal?: AbortSignal) => get<Income>(`/api/income?${new URLSearchParams({ time })}`, signal);
export const fetchAccounts = (signal?: AbortSignal) => get<Accounts>("/api/accounts", signal);
export type Status = { title: string | null; file: string; currency: string; transactions: number; errors: number; sync: Sync | null };
export const fetchStatus = (signal?: AbortSignal) => get<Status>("/api/status", signal);

/** 请 git-sync 马上拉取，返回请求时间（服务器的 UTC，到秒）。 */
export async function requestSync(): Promise<string> {
  const r = await fetch("/api/sync", { method: "POST" });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.detail ?? `请求失败（${r.status}）`);
  return body.requested;
}
