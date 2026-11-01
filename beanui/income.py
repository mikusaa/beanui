"""收支表：一段时间的收入、支出按分类展开，和上一段同期比。口径同首页（overview._totals）。"""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from .ledger import Ledger, _fmt, _group
from .overview import _percent, _totals, current_period, monthly_json, previous_period


def income_json(ledger: Ledger, time: str = "year") -> dict:
    today = ledger.today()
    start, end, capped = current_period(ledger, time)
    current = _totals(ledger, start, end)
    prev = previous_period(time, start, end, capped)
    before = _totals(ledger, *prev) if prev else None

    income, expense = current["income"], current["expense"]
    compare = None
    if before:
        compare = {
            "start": prev[0].isoformat(),
            "end": (prev[1] - timedelta(days=1)).isoformat(),
            "income": _fmt(before["income"]),
            "expense": _fmt(before["expense"]),
            "net": _fmt(before["income"] - before["expense"]),
            "savings_rate": _savings_rate(before["income"], before["expense"]),
            "income_change": _percent(income - before["income"], before["income"]),
            "expense_change": _percent(expense - before["expense"], before["expense"]),
        }

    last = end - timedelta(days=1)
    return {
        "currency": ledger.currency,
        "time": time,
        "start": start.isoformat(),
        "end": last.isoformat(),
        "capped": capped,
        "income": _fmt(income),
        "expense": _fmt(expense),
        "net": _fmt(income - expense),
        "savings_rate": _savings_rate(income, expense),
        "compare": compare,
        "sides": {
            "income": _groups(ledger, current["income_categories"], before and before["income_categories"]),
            "expense": _groups(ledger, current["categories"], before and before["categories"]),
        },
        # 到所选范围最后一个月为止的 12 个月
        "months": monthly_json(ledger, last),
        # 「选年月」列的年份：今天及以前有交易的年份，新的在前
        "years": sorted({t.entry.date.year for t in ledger.txns if t.entry.date <= today}, reverse=True),
    }


def _savings_rate(income: Decimal, expense: Decimal) -> float | None:
    return _percent(income - expense, income) if income > 0 else None


def _groups(ledger: Ledger, categories: dict[str, Decimal], previous: dict[str, Decimal] | None) -> list[dict]:
    """前三段的分类再按第二段分组（Expenses:Food:Meals 归到 Expenses:Food），组和组内都按金额从大到小。
    组下只有记在组科目本身的一类时不再列子类。金额为零的分类不列；各组加起来等于总额。"""

    def row(account: str, amount: Decimal, before: Decimal | None) -> dict:
        return {
            "account": account,
            "name": ledger.account_name(account),
            "amount": _fmt(amount),
            "previous": _fmt(before) if before is not None else None,
            "change": _percent(amount - before, before) if before is not None and before > 0 else None,
        }

    def parent(account: str) -> str:
        return ":".join(account.split(":")[:2])

    prev_groups: dict[str, Decimal] = defaultdict(Decimal)
    for account, amount in (previous or {}).items():
        prev_groups[parent(account)] += amount

    children: dict[str, list[tuple[str, Decimal]]] = defaultdict(list)
    for account, amount in categories.items():
        if amount:
            children[parent(account)].append((account, amount))

    out = []
    for group, members in children.items():
        total = sum((a for _, a in members), Decimal(0))
        members.sort(key=lambda x: (-x[1], x[0]))
        lookup = (lambda a: previous.get(a, Decimal(0))) if previous is not None else (lambda a: None)
        out.append(
            {
                **row(group, total, prev_groups[group] if previous is not None else None),
                "group": _group(group),
                "children": [] if [a for a, _ in members] == [group] else [row(a, v, lookup(a)) for a, v in members],
            }
        )
    out.sort(key=lambda g: (-Decimal(g["amount"]), g["account"]))
    return out
