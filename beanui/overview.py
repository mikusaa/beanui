"""首页概览：一段时间的收支、支出分类、信用卡额度、最近交易和同步状态。"""

from __future__ import annotations

import calendar
import os
import tempfile
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from .config import Config
from .ledger import Ledger, Txn, _fmt, _group, parse_time

RECENT = 5
MONTHS = 12


def overview_json(ledger: Ledger, time: str = "month", recent: int = RECENT, sync_dir: Path | None = None) -> dict:
    today = ledger.today()
    start, end, capped = current_period(ledger, time)
    current = _totals(ledger, start, end)
    prev = previous_period(time, start, end, capped)
    compare = None
    if prev:
        before = _totals(ledger, *prev)
        compare = {
            "start": prev[0].isoformat(),
            "end": (prev[1] - timedelta(days=1)).isoformat(),
            "expense": _fmt(before["expense"]),
            "change": _percent(current["expense"] - before["expense"], before["expense"]),
        }

    income, expense = current["income"], current["expense"]
    categories = sorted(
        ((a, v) for a, v in current["categories"].items() if v > 0), key=lambda x: (-x[1], x[0])
    )
    return {
        "title": ledger.options.get("title"),
        "currency": ledger.currency,
        "time": time,
        "start": start.isoformat(),
        "end": (end - timedelta(days=1)).isoformat(),
        "expense": _fmt(expense),
        "income": _fmt(income),
        "net": _fmt(income - expense),
        "savings_rate": _percent(income - expense, income) if income > 0 else None,
        "compare": compare,
        "categories": [
            {"account": a, "name": ledger.account_name(a), "group": _group(a), "amount": _fmt(v)}
            for a, v in categories
        ],
        "months": monthly_json(ledger, today),
        "credit": credit_json(ledger, today),
        "recent": [ledger.summary_json(t) for t in ledger.txns if t.entry.date <= today][:recent],
        "sync": read_sync_status(ledger.root, sync_dir),
    }


def current_period(ledger: Ledger, time: str) -> tuple[date, date, bool]:
    """时间范围的 [起, 止)。本期只算到今天：账本里预先记好的分期、订阅还没发生；capped 表示截在了今天。"""
    today = ledger.today()
    start, end = parse_time(time, today)
    capped = end is None or end > today + timedelta(days=1)
    if capped:
        end = today + timedelta(days=1)
    if start is None:
        start = min((t.entry.date for t in ledger.txns), default=today)
    return start, end, capped


def _totals(ledger: Ledger, start: date, end: date) -> dict:
    """和流水页的合计口径一样：只算主货币，支出取支出分录、收入取收入分录。
    分类按科目前三段归并（Expenses:Tech:Cloud:Domains → Expenses:Tech:Cloud），各类加起来等于总支出；
    收入分类同样归并，只算收入类交易（消费、还款里顺带的优惠不算），各类加起来等于总收入。"""
    expense, income = Decimal(0), Decimal(0)
    categories: dict[str, Decimal] = defaultdict(Decimal)
    income_categories: dict[str, Decimal] = defaultdict(Decimal)
    for t in _between(ledger.txns, start, end):
        if t.currency != ledger.currency:
            continue
        if t.kind == "expense":
            expense -= t.amount
            for p in t.entry.postings:
                if p.account.startswith("Expenses:") and p.units and p.units.currency == t.currency:
                    categories[":".join(p.account.split(":")[:3])] += p.units.number
        elif t.kind == "income":
            income += t.amount
            for p in t.entry.postings:
                if p.account.startswith("Income:") and p.units and p.units.currency == t.currency:
                    income_categories[":".join(p.account.split(":")[:3])] -= p.units.number
    return {"expense": expense, "income": income, "categories": categories, "income_categories": income_categories}


def monthly_json(ledger: Ledger, until: date, months: int = MONTHS) -> list[dict]:
    """到 until 那个月为止几个月每月的收入和支出，从早到晚，最后一个月只算到 until；口径同 _totals。
    首页传今天，不随时间范围变；收支表传所选范围的最后一天。"""
    out = []
    for k in range(months - 1, -1, -1):
        start = _shift_months(until.replace(day=1), -k)
        end = min(_shift_months(start, 1), until + timedelta(days=1))
        totals = _totals(ledger, start, end)
        out.append({"month": start.strftime("%Y-%m"), "income": _fmt(totals["income"]), "expense": _fmt(totals["expense"])})
    return out


def _between(txns: list[Txn], start: date, end: date):
    return (t for t in txns if start <= t.entry.date < end)


def _percent(part: Decimal, whole: Decimal) -> float | None:
    if not whole:
        return None
    return round(float(part / whole * 100), 1)


def previous_period(time: str, start: date, end: date, capped: bool) -> tuple[date, date] | None:
    """用来比较的上一段：本周比上周同期，本月比上月同期，近三月比再往前三个月，今年比去年同期。
    整段已经过完的（上月、某年、某月）和前一整段比。"""
    if time == "week":
        return start - timedelta(days=7), end - timedelta(days=7)
    if time in ("all", ""):
        return None
    months = {"month": 1, "last-month": 1, "3months": 3, "year": 12}.get(time)
    if months is None:
        months = 12 if "-" not in time else 1
    prev_start = _shift_months(start, -months)
    if capped:
        # 同期：最后一天往前挪，月底对不上时取那个月的最后一天
        prev_end = _shift_months(end - timedelta(days=1), -months) + timedelta(days=1)
    else:
        prev_end = _shift_months(end, -months)
    return prev_start, prev_end


def _shift_months(d: date, n: int) -> date:
    y, m = divmod(d.year * 12 + d.month - 1 + n, 12)
    m += 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


# ── 信用卡额度 ────────────────────────────────────────────


def credit_json(ledger: Ledger, as_of: date) -> dict:
    """截至今天的完整欠款，不受首页时间范围影响；未来日期的分期不计入。"""
    balances: dict[str, Decimal] = defaultdict(Decimal)
    for t in ledger.txns:
        if t.entry.date > as_of:
            continue
        for p in t.entry.postings:
            if ledger.config.is_credit_card(p.account) and p.units and p.units.currency == ledger.currency:
                balances[ledger.config.credit_card_bank(p.account)] += p.units.number
    accounts = {a: info["meta"] for a, info in ledger.accounts.items()}
    try:
        rows = credit_card_rows(accounts, balances, ledger.config)
    except ValueError as err:
        return {"as_of": as_of.isoformat(), "rows": [], "error": str(err), "utilization": None, "level": None, "limit": None, "used": None}

    limited = [r for r in rows if r["limit"] is not None]
    total_limit = sum((r["limit"] for r in limited), Decimal(0))
    total_used = sum((r["used"] for r in limited), Decimal(0))
    utilization = _percent(total_used, total_limit) if total_limit else None
    out = []
    for r in rows:
        brand = ledger.account_brand(r["id"])
        out.append(
            {
                **r,
                "limit": _fmt(r["limit"]) if r["limit"] is not None else None,
                "used": _fmt(r["used"]),
                "available": _fmt(r["available"]) if r["available"] is not None else None,
                "brand": brand.to_json() if brand else None,
            }
        )
    return {
        "as_of": as_of.isoformat(),
        "rows": out,
        "error": None,
        "utilization": utilization,
        "level": utilization_level(utilization),
        # 额度只加有额度的卡；已用是所有卡的欠款，没设额度的卡也算
        "limit": _fmt(total_limit) if limited else None,
        "used": _fmt(sum((r["used"] for r in rows), Decimal(0))),
    }


def credit_card_rows(accounts: dict[str, dict], balances: dict[str, Decimal], config: Config | None = None) -> list[dict]:
    """按银行（信用卡科目根下面一段）合并，共享额度和卡数写在银行账户上，
    也可以每张卡写同样的值；写得不一致或不是非负数时报错，不悄悄加起来。"""
    config = config or Config()
    groups: dict[str, list[str]] = {}
    for account in accounts:
        if config.is_credit_card(account):
            groups.setdefault(config.credit_card_bank(account), []).append(account)
    for bank in balances:
        groups.setdefault(bank, [])

    rows = []
    for bank_id, members in groups.items():

        def meta(key: str):
            parent = (accounts.get(bank_id) or {}).get(key)
            if parent is not None:
                return parent
            values = {accounts[a].get(key) for a in members} - {None}
            if len(values) > 1:
                raise ValueError(f"{bank_id} 的 {key} 配置不一致，请在银行账户上统一设置共享额度和总卡数。")
            return next(iter(values), None)

        def number_meta(key: str, integer: bool = False) -> Decimal | None:
            value = meta(key)
            if value is None:
                return None
            ok = isinstance(value, (int, Decimal)) and not isinstance(value, bool) and value >= 0
            if not ok or integer and value != int(value):
                raise ValueError(f"{bank_id} 的 {key} 必须是非负{'整数' if integer else '数字'}。")
            return Decimal(value)

        limit = number_meta("credit-limit")
        cards = number_meta("card-count", integer=True)
        used = -balances.get(bank_id, Decimal(0)) + 0  # + 0 去掉 -0
        code = bank_id.split(":")[-1]
        rows.append(
            {
                "id": bank_id,
                "bank": str(meta("bank-name") or config.banks.get(code, code)),
                "cards": int(cards) if cards is not None else None,
                "limit": limit,
                "used": used,
                "available": limit - used if limit is not None else None,
                "utilization": float(used / limit * 100) if limit else None,
            }
        )
    # 有额度的在前，使用率高的在前，最后按银行名的码位
    rows.sort(
        key=lambda r: (
            r["limit"] is None,
            -(r["utilization"] if r["utilization"] is not None else float("-inf")),
            r["bank"],
        )
    )
    for r in rows:
        r["level"] = utilization_level(r["utilization"])
        if r["utilization"] is not None:
            r["utilization"] = round(r["utilization"], 1)
    return rows


def utilization_level(value: float | None) -> str | None:
    """≥100 超额、≥80 偏高、≥50 留意，其余正常。"""
    if value is None:
        return None
    if value >= 100:
        return "over"
    if value >= 80:
        return "high"
    if value >= 50:
        return "warn"
    return "ok"


# ── 同步状态 ──────────────────────────────────────────────


def read_sync_status(root: Path, sync_dir: Path | None = None) -> dict | None:
    """账本仓库 .git/sync-status 的一行：`ok <UTC 时间> <短提交号>` 或 `error <UTC 时间> <错误信息>`。
    本机开发时没有这个文件，返回 None。

    设了同步目录（NAS 上和 git-sync 共用的卷）时可以手动同步：`can_sync` 为真，
    `pending` 是请求还没被 git-sync 取走。"""
    try:
        line = (root / ".git" / "sync-status").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    state, _, rest = line.partition(" ")
    stamp, _, detail = rest.partition(" ")
    try:
        when = datetime.fromisoformat(stamp)
    except ValueError:
        return None
    extra = {"can_sync": sync_dir is not None, "pending": sync_dir is not None and (sync_dir / "request").exists()}
    if state == "ok":
        return {"state": "ok", "time": when.isoformat(), "commit": detail.strip() or None, "message": None, **extra}
    if state == "error":
        return {"state": "error", "time": when.isoformat(), "commit": None, "message": detail.strip(), **extra}
    return None


def request_sync(sync_dir: Path) -> str:
    """在同步目录写请求文件，git-sync 看到后马上拉取。已经有请求时不重写，返回原来的请求时间。
    时间只到秒，和 sync-status 的精度一样，前端拿它比较「拉取晚于请求」。"""
    req = sync_dir / "request"
    try:
        return req.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        pass
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    # 先写临时文件再改名，git-sync 不会读到写了一半的文件
    fd, tmp = tempfile.mkstemp(dir=sync_dir, prefix=".request-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(stamp + "\n")
        os.replace(tmp, req)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return stamp
