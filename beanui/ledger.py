"""加载账本，把交易整理成界面要的样子。文件变化时重新加载。"""

from __future__ import annotations

import os
import subprocess
import threading
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from beancount import loader
from beancount.core import compare, data, interpolate, prices

from .brands import Brand, Brands
from .config import Config

WEEKDAYS = "一二三四五六日"
FUNDING_ROOTS = ("Assets", "Liabilities", "Equity")

# 流水里能显示的指令类型，次序同界面上的开关；销户和开户算一类。填充（pad）生成的交易本来就在交易里
ENTRY_TYPES = ("txn", "balance", "open", "note", "price", "document")
DIRECTIVE_TYPES = {
    data.Balance: "balance",
    data.Open: "open",
    data.Close: "open",
    data.Note: "note",
    data.Price: "price",
    data.Document: "document",
}
TYPE_NAMES = {"balance": "余额断言", "open": "开户", "note": "备注", "price": "价格", "document": "文档"}


def _fmt(amount: Decimal) -> str:
    return f"{amount:.2f}"


@dataclass
class Txn:
    id: str
    entry: data.Transaction
    kind: str  # expense | income | transfer
    amount: Decimal  # 支出为负、收入为正、转账为正
    currency: str
    category: str | None  # 主分类科目
    sources: list[str]  # 出钱的资金科目
    targets: list[str]  # 进钱的资金科目
    brand: Brand | None
    search: str = field(repr=False)


@dataclass
class Directive:
    """流水里交易以外的指令：余额断言、开户和销户、备注、价格、文档。"""

    id: str
    entry: data.Directive
    type: str  # balance | open | note | price | document
    account: str | None  # 价格没有科目
    search: str = field(repr=False)


Row = Txn | Directive


def _type(r: Row) -> str:
    return "txn" if isinstance(r, Txn) else r.type


class Ledger:
    def __init__(self, path: str | os.PathLike, brands: Brands, today=date.today, config: Config | None = None):
        self.path = Path(path).resolve()
        self.brands = brands
        self.config = config or Config()
        self.today = today
        self._lock = threading.Lock()
        self._stamp: dict[str, float] = {}
        self._load()

    # ── 加载 ──────────────────────────────────────────────

    def _snapshot(self, files: list[str]) -> dict[str, float]:
        """被 include 的文件和它们所在目录的修改时间；目录变了说明有新增或删除的文件。"""
        paths = set(files) | {os.path.dirname(f) for f in files}
        stamp = {}
        for p in paths:
            try:
                stamp[p] = os.stat(p).st_mtime_ns
            except FileNotFoundError:
                stamp[p] = -1
        return stamp

    def _load(self) -> None:
        before = self._snapshot([p for p in self._stamp if not os.path.isdir(p)] or [str(self.path)])
        entries, errors, options = loader.load_file(str(self.path))
        self.options = options
        self.errors = errors
        self.currency = (options.get("operating_currency") or ["CNY"])[0]
        self.root = _git_root(self.path.parent) or self.path.parent
        self.price_map = prices.build_price_map(entries)

        self.accounts: dict[str, dict] = {}
        for e in entries:
            if isinstance(e, data.Open):
                self.accounts[e.account] = {
                    "meta": e.meta,
                    "brand": self.brands.for_account(e.account, e.meta),
                }

        self.commodities = {e.currency: e.meta for e in entries if isinstance(e, data.Commodity)}

        rows: list[Row] = []
        seen: Counter[str] = Counter()
        for e in _by_time(entries):
            is_txn = isinstance(e, data.Transaction)
            if not is_txn and type(e) not in DIRECTIVE_TYPES:
                continue
            h = compare.hash_entry(e, exclude_meta=True)[:12]
            seen[h] += 1
            # 内容完全相同的交易（如同一天充值四次）按出现顺序加后缀
            rid = h if seen[h] == 1 else f"{h}-{seen[h]}"
            rows.append(self._summarize(rid, e) if is_txn else self._directive(rid, e))
        # 新的在前；同一天按 time: 倒过来。开户、余额断言排在当天交易前面，倒过来就在最下面
        self.rows = list(reversed(rows))
        self.txns = [r for r in self.rows if isinstance(r, Txn)]
        self.by_id: dict[str, Row] = {r.id: r for r in self.rows}
        stamp = self._snapshot(options.get("include") or [str(self.path)])
        # 加载要零点几秒，git pull 可能正好在这时写文件：加载期间变过的记成加载前的时间，下一次请求再加载
        for p, t in before.items():
            if p in stamp:
                stamp[p] = t
        self._stamp = stamp

    def refresh(self) -> None:
        with self._lock:
            files = [p for p in self._stamp if not os.path.isdir(p)]
            if self._snapshot(files) != self._stamp:
                self._load()

    # ── 科目 ──────────────────────────────────────────────

    def account_name(self, account: str) -> str:
        """open 指令的 name: 元数据；没有时用科目末段，末段是卡号时带上上一段。"""
        meta = self.accounts.get(account, {}).get("meta") or {}
        if name := meta.get("name"):
            return str(name)
        parts = account.split(":")
        if len(parts) > 2 and parts[-1].isdigit():
            return f"{parts[-2]} {parts[-1]}"
        return parts[-1]

    def account_brand(self, account: str) -> Brand | None:
        info = self.accounts.get(account)
        return info["brand"] if info else self.brands.for_account(account, {})

    def commodity_name(self, currency: str) -> str:
        """commodity 指令的 name: 元数据；没有时就是代码本身。"""
        return str((self.commodities.get(currency) or {}).get("name") or currency)

    # ── 交易 ──────────────────────────────────────────────

    def _summarize(self, tid: str, e: data.Transaction) -> Txn:
        def units(p):
            return p.units.number if p.units and p.units.number is not None else Decimal(0)

        expenses = [p for p in e.postings if p.account.startswith("Expenses:")]
        incomes = [p for p in e.postings if p.account.startswith("Income:")]
        funding = [p for p in e.postings if p.account.split(":")[0] in FUNDING_ROOTS]

        moves_out = any(units(p) < 0 for p in funding)
        moves_in = any(units(p) > 0 for p in funding)
        if expenses:
            kind, main = "expense", expenses
        elif incomes and not (moves_out and moves_in):
            kind, main = "income", incomes
        else:
            # 资金科目之间互转；还款时顺带的优惠等收入不改变它是转账
            kind = "transfer"
            main = [p for p in funding if units(p) > 0] or [p for p in e.postings if units(p) > 0] or e.postings

        lead = max(main, key=lambda p: abs(units(p)))
        currency = lead.units.currency if lead.units else self.currency
        same = [units(p) for p in main if p.units and p.units.currency == currency]
        amount = sum(same, Decimal(0))
        if kind != "transfer":
            amount = -amount

        sources = _unique(p.account for p in funding if units(p) < 0)
        targets = _unique(p.account for p in funding if units(p) > 0)
        category = lead.account if kind != "transfer" else None

        search = " ".join(
            [
                e.payee or "",
                e.narration or "",
                *(f"#{t}" for t in e.tags or ()),
                *(p.account for p in e.postings),
                *(self.account_name(p.account) for p in e.postings),
            ]
        ).casefold()

        return Txn(
            id=tid,
            entry=e,
            kind=kind,
            amount=amount,
            currency=currency,
            category=category,
            sources=sources,
            targets=targets,
            brand=self.brands.for_transaction(e.meta, e.payee, e.narration),
            search=search,
        )

    def summary_json(self, t: Txn) -> dict:
        e = t.entry
        names = lambda accts: [self.account_name(a) for a in accts]  # noqa: E731
        return {
            "id": t.id,
            "date": e.date.isoformat(),
            "type": "txn",
            "flag": e.flag,
            "payee": e.payee or "",
            "narration": e.narration or "",
            "tags": sorted(e.tags or ()),
            "kind": t.kind,
            "amount": _fmt(t.amount),
            "currency": t.currency,
            "category": (
                {"account": t.category, "name": self.account_name(t.category), "group": _group(t.category)}
                if t.category
                else None
            ),
            "sources": names(t.sources),
            "targets": names(t.targets),
            # 同上两项，带科目和账户徽标，电脑端在名字前画小图标
            "funds": {"sources": [self._fund_json(a) for a in t.sources], "targets": [self._fund_json(a) for a in t.targets]},
            "brand": t.brand.to_json() if t.brand else None,
        }

    def _fund_json(self, account: str) -> dict:
        brand = self.account_brand(account)
        return {"account": account, "name": self.account_name(account), "brand": brand.to_json() if brand else None}

    def detail_json(self, t: Txn) -> dict:
        e = t.entry
        filename = e.meta.get("filename", "")
        lineno = e.meta.get("lineno", 0)
        postings = []
        for p in e.postings:
            root = p.account.split(":")[0]
            brand = self.account_brand(p.account) if root in FUNDING_ROOTS else None
            postings.append(
                {
                    "account": p.account,
                    "name": self.account_name(p.account),
                    "amount": _fmt(p.units.number) if p.units and p.units.number is not None else None,
                    "currency": p.units.currency if p.units else None,
                    "group": _group(p.account) if root not in FUNDING_ROOTS else None,
                    "brand": brand.to_json() if brand else None,
                }
            )
        residual = interpolate.compute_residual(e.postings)
        tolerances = interpolate.infer_tolerances(e.postings, self.options)

        # 同一收付方的其他交易；没写收付方时按认出的品牌找
        def related(o: Txn) -> bool:
            if o.id == t.id:
                return False
            if e.payee:
                return o.entry.payee == e.payee
            return bool(t.brand and o.brand and o.brand.id == t.brand.id)

        # 已经发生的在前，新到旧；未来的在后，近到远。只列 5 条，先保证已经发生的
        today = self.today()
        same = [o for o in self.txns if related(o)]
        past = [o for o in same if o.entry.date <= today]
        future = [o for o in reversed(same) if o.entry.date > today]
        others = [self.summary_json(o) for o in (past + future)[:5]]

        return {
            **self.summary_json(t),
            "postings": postings,
            "balanced": residual.is_small(tolerances),
            "source": {
                "file": _relative(filename, self.root),
                "line": lineno,
                "text": _source_text(filename, lineno),
            },
            "commit": _blame(self.root, filename, lineno),
            "others": others,
        }

    # ── 其他指令 ──────────────────────────────────────────

    def _directive(self, did: str, e: data.Directive) -> Directive:
        kind = DIRECTIVE_TYPES[type(e)]
        account = getattr(e, "account", None)
        words = ["销户" if isinstance(e, data.Close) else TYPE_NAMES[kind]]
        if account:
            words += [account, self.account_name(account)]
        if isinstance(e, data.Price):
            words += [e.currency, self.commodity_name(e.currency)]
        if isinstance(e, data.Note):
            words.append(e.comment or "")
        if isinstance(e, data.Document):
            words.append(os.path.basename(e.filename))
        words += [f"#{t}" for t in getattr(e, "tags", None) or ()]
        return Directive(id=did, entry=e, type=kind, account=account, search=" ".join(words).casefold())

    def directive_json(self, d: Directive) -> dict:
        """各类指令共有 id、date、type、account、name、brand，其余字段按类型给。"""
        e = d.entry
        if d.account:
            brand = self.account_brand(d.account)
        else:
            # 价格：commodity 上的 brand: 元数据，没有时按商品名匹配品牌表（「某某黄金份额」→ 某某）
            brand = self.brands.for_transaction(self.commodities.get(e.currency) or {}, None, self.commodity_name(e.currency))
        out = {
            "id": d.id,
            "date": e.date.isoformat(),
            "type": d.type,
            "account": d.account,
            "name": self.account_name(d.account) if d.account else self.commodity_name(e.currency),
            "brand": brand.to_json() if brand else None,
        }
        match e:
            case data.Balance():
                # 断言失败时 beancount 在 diff_amount 里记「实际 − 断言」
                diff = e.diff_amount.number if e.diff_amount else None
                out |= {
                    "amount": _fmt(e.amount.number),
                    "currency": e.amount.currency,
                    "ok": diff is None,
                    "diff": _fmt(diff) if diff is not None else None,
                    "actual": _fmt(e.amount.number + (diff or 0)),
                }
            case data.Open():
                out |= {"action": "open", "currencies": list(e.currencies or [])}
            case data.Close():
                out |= {"action": "close", "currencies": []}
            case data.Note():
                out |= {"comment": e.comment or ""}
            case data.Price():
                # 价格的小数位按账本原样给，不截成两位
                out |= {"currency": e.currency, "amount": str(e.amount.number), "quote": e.amount.currency}
            case data.Document():
                out |= {"filename": os.path.basename(e.filename), "path": _relative(e.filename, self.root)}
        if d.type in ("note", "document"):
            out["tags"] = sorted(e.tags or ())
        return out

    def directive_detail_json(self, d: Directive) -> dict:
        filename = d.entry.meta.get("filename", "")
        lineno = d.entry.meta.get("lineno", 0)
        return {
            **self.directive_json(d),
            "source": {"file": _relative(filename, self.root), "line": lineno, "text": _source_text(filename, lineno)},
            "commit": _blame(self.root, filename, lineno),
        }

    def row_json(self, r: Row) -> dict:
        return self.summary_json(r) if isinstance(r, Txn) else self.directive_json(r)

    # ── 查询 ──────────────────────────────────────────────

    def filter(
        self,
        time: str = "month",
        q: str = "",
        accounts: list[str] = (),
        tag: str = "",
        payee: str = "",
    ) -> list[Row]:
        """交易和其他指令都筛，类型留给 journal_json 挑。accounts 里每个科目（含子科目）都要出现在交易的分录里；
        其他指令的科目要落在每个科目之下，没有科目的价格在筛科目时不出现，没有收付方的指令在筛收付方时不出现。"""
        start, end = parse_time(time, self.today())
        tokens = q.casefold().split()

        def under(account: str, a: str) -> bool:
            return account == a or account.startswith(a + ":")

        out = []
        for r in self.rows:
            e = r.entry
            if start and e.date < start or end and e.date >= end:
                continue
            if isinstance(r, Txn):
                if not all(any(under(p.account, a) for p in e.postings) for a in accounts):
                    continue
                if payee and (e.payee or "") != payee:
                    continue
            else:
                if accounts and not (r.account and all(under(r.account, a) for a in accounts)):
                    continue
                if payee:
                    continue
            if tag and tag not in (getattr(e, "tags", None) or ()):
                continue
            if tokens and not all(tok in r.search for tok in tokens):
                continue
            out.append(r)
        return out

    def journal_json(self, rows: list[Row], types=("txn",), offset: int = 0, limit: int = 200) -> dict:
        """按日分组的流水，只列 types 里的类型。日期在今天以后的（预记的分期、订阅）单独放在 future 里一次给全，
        不计入笔数、合计和各类型的条数，也不分页；没有时为 None。
        count 和合计只算交易，不管交易的开关开没开；types 是筛选后各类型的条数，开关上显示。"""
        today = self.today()
        past = [r for r in rows if r.entry.date <= today]
        txns = [r for r in past if isinstance(r, Txn)]
        counts = Counter(_type(r) for r in past)
        shown = [r for r in past if _type(r) in types]
        future = [r for r in rows if r.entry.date > today and _type(r) in types]
        days, totals = self._day_totals(txns)
        page = shown[offset : offset + limit]
        return {
            "count": len(txns),
            "currency": self.currency,
            "expense": _fmt(-totals["expense"]),
            "income": _fmt(totals["income"]),
            "types": {t: counts[t] for t in ENTRY_TYPES},
            "days": self._days_json(page, days),
            "next": offset + limit if offset + limit < len(shown) else None,
            "future": self._future_json(future) if future else None,
        }

    def _future_json(self, rows: list[Row]) -> dict:
        days, totals = self._day_totals([r for r in rows if isinstance(r, Txn)])
        dates = [r.entry.date for r in rows]
        return {
            "count": len(rows),
            "expense": _fmt(-totals["expense"]),
            "income": _fmt(totals["income"]),
            # 预记的多是分期还款这类转账；没有支出和收入时标题写转账合计，同日合计
            "transfer": _fmt(sum((d["transfer"] for d in days.values()), Decimal(0))),
            "first": min(dates).isoformat(),
            "last": max(dates).isoformat(),
            "days": self._days_json(rows, days),
        }

    def _day_totals(self, txns: list[Txn]) -> tuple[dict[date, dict], dict]:
        """每天的支出、收入、转账和整段的支出、收入，只算主货币。"""
        totals = {"expense": Decimal(0), "income": Decimal(0)}
        days: dict[date, dict] = {}
        for t in txns:
            day = days.setdefault(
                t.entry.date, {"expense": Decimal(0), "income": Decimal(0), "transfer": Decimal(0)}
            )
            if t.currency == self.currency:
                day[t.kind] += t.amount
                if t.kind != "transfer":
                    totals[t.kind] += t.amount
        return days, totals

    def _days_json(self, rows: list[Row], days: dict[date, dict]) -> list[dict]:
        """rows 按日分组；日合计按 days 里的整天算，分页时跨页的那天也一样。只有其他指令的那天合计为零。"""
        grouped: dict[date, list] = defaultdict(list)
        for r in rows:
            grouped[r.entry.date].append(self.row_json(r))
        zero = {"expense": Decimal(0), "income": Decimal(0), "transfer": Decimal(0)}
        return [
            {
                "date": d.isoformat(),
                "weekday": "周" + WEEKDAYS[d.weekday()],
                "expense": _fmt(-days.get(d, zero)["expense"]),
                "income": _fmt(days.get(d, zero)["income"]),
                "transfer": _fmt(days.get(d, zero)["transfer"]),
                "items": items,
            }
            for d, items in grouped.items()
        ]

    def facets_json(self) -> dict:
        accounts: Counter[str] = Counter()
        tags: Counter[str] = Counter()
        payees: Counter[str] = Counter()
        for t in self.txns:
            e = t.entry
            for a in {p.account for p in e.postings}:
                accounts[a] += 1
            for tag in e.tags or ():
                tags[tag] += 1
            if e.payee:
                payees[e.payee] += 1

        def accts(roots):
            return [
                {"account": a, "name": self.account_name(a), "count": n}
                for a, n in sorted(accounts.items())
                if a.split(":")[0] in roots
            ]

        return {
            "years": sorted({t.entry.date.year for t in self.txns}, reverse=True),
            "accounts": accts(("Assets", "Liabilities")),
            "categories": accts(("Expenses", "Income")),
            "tags": [{"tag": k, "count": n} for k, n in tags.most_common()],
            "payees": [{"payee": k, "count": n} for k, n in payees.most_common()],
            # 没记过账的科目（如信用卡按银行合并的父科目）也会被当作筛选条件，标签要用它们的名字
            "names": {a: self.account_name(a) for a in sorted(self.accounts)},
        }


# ── 工具 ──────────────────────────────────────────────────


def _by_time(entries: list) -> list:
    """同一天的交易按 time: 元数据排序。beancount 同一天按行号排，行号不分文件，跨文件就乱了。

    没写时间的交易跟同一文件、同一天里前一笔有时间的，没有前一笔就跟后一笔，都没有就排在当天最后；
    时间相同的保持原顺序。开户、余额断言、销户等仍按 beancount 的指令顺序排在交易前后。
    """
    groups: dict[tuple, list[int]] = defaultdict(list)
    for i, e in enumerate(entries):
        if isinstance(e, data.Transaction):
            groups[(e.meta.get("filename"), e.date)].append(i)
    when = [""] * len(entries)
    for idx in groups.values():
        times = [entries[i].meta.get("time") for i in idx]
        known = [str(t) for t in times if t is not None]
        last = known[0] if known else "~"
        for i, t in zip(idx, times):
            if t is not None:
                last = str(t)
            when[i] = last
    order = sorted(
        range(len(entries)),
        key=lambda i: (entries[i].date, data.SORT_ORDER.get(type(entries[i]), 0), when[i], i),
    )
    return [entries[i] for i in order]


def parse_time(value: str, today: date) -> tuple[date | None, date | None]:
    """返回 [起, 止)。支持 week（周一起）、month、last-month、3months、year、all、YYYY、YYYY-MM。"""

    def month_start(y: int, m: int) -> date:
        while m < 1:
            y, m = y - 1, m + 12
        while m > 12:
            y, m = y + 1, m - 12
        return date(y, m, 1)

    y, m = today.year, today.month
    match value:
        case "all" | "":
            return None, None
        case "week":
            monday = today - timedelta(days=today.weekday())
            return monday, monday + timedelta(days=7)
        case "month":
            return month_start(y, m), month_start(y, m + 1)
        case "last-month":
            return month_start(y, m - 1), month_start(y, m)
        case "3months":
            return month_start(y, m - 2), month_start(y, m + 1)
        case "year":
            return date(y, 1, 1), date(y + 1, 1, 1)
    parts = value.split("-")
    if len(parts) == 1 and parts[0].isdigit():
        return date(int(parts[0]), 1, 1), date(int(parts[0]) + 1, 1, 1)
    if len(parts) == 2 and all(x.isdigit() for x in parts):
        yy, mm = int(parts[0]), int(parts[1])
        if 1 <= mm <= 12:
            return month_start(yy, mm), month_start(yy, mm + 1)
    raise ValueError(f"无法识别的时间范围：{value}")


def _group(account: str) -> str:
    """分类图标按第二段取：Expenses:Food:Meals → Food；Income:Salary → Income。"""
    parts = account.split(":")
    return "Income" if parts[0] == "Income" else (parts[1] if len(parts) > 1 else parts[0])


def _unique(items) -> list:
    return list(dict.fromkeys(items))


def _git_root(start: Path) -> Path | None:
    for p in (start, *start.parents):
        if (p / ".git").exists():
            return p
    return None


def _relative(filename: str, root: Path) -> str:
    try:
        return str(Path(filename).resolve().relative_to(root))
    except ValueError:
        return filename


def _source_text(filename: str, lineno: int) -> str:
    """交易在源文件里的原文：从首行到下一个空行或下一条指令。"""
    try:
        lines = Path(filename).read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    out = []
    for i, line in enumerate(lines[lineno - 1 :]):
        if i and (not line.strip() or not line[:1].isspace()):
            break
        out.append(line)
    return "\n".join(out)


def _blame(root: Path, filename: str, lineno: int) -> dict | None:
    """这一行最后一次提交的短哈希和时间；不在 git 里或还没提交时返回 None。"""
    if not (root / ".git").exists() or not filename:
        return None
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "blame", "--porcelain", "-L", f"{lineno},{lineno}", "--", filename],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    lines = out.splitlines()
    if not lines:
        return None
    sha = lines[0].split()[0]
    if set(sha) == {"0"}:
        return None
    ts = next((int(l.split()[1]) for l in lines if l.startswith("committer-time ")), None)
    return {"hash": sha[:7], "time": ts}
