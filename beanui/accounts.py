"""账户页：截至今天的资产、负债、净资产和近 12 个月的净资产走势。"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from beancount.core import prices

from .ledger import Ledger, _fmt

SIDES = {"assets": "Assets", "liabilities": "Liabilities"}
TREND_MONTHS = 12

Balances = dict[str, Decimal]  # 币种 → 数量


def accounts_json(ledger: Ledger) -> dict:
    """余额截至今天，预先记的分期不算。主货币以外的币种按今天以前最近的 price 换算，
    没有价格的单独列出，不计入合计。负债的金额取反，欠款为正。"""
    today = ledger.today()
    balances: dict[str, Balances] = defaultdict(lambda: defaultdict(Decimal))
    for t in ledger.txns:
        if t.entry.date > today:
            continue
        for p in t.entry.postings:
            if p.account.split(":")[0] in SIDES.values() and p.units and p.units.number is not None:
                balances[p.account][p.units.currency] += p.units.number

    sides = {key: _side(ledger, root, balances, today) for key, root in SIDES.items()}
    custody = _custody(ledger, balances, today)
    assets = sum((Decimal(g["amount"]) for g in sides["assets"]), Decimal(0))
    liabilities = sum((Decimal(g["amount"]) for g in sides["liabilities"]), Decimal(0))
    net = assets - liabilities + sum((Decimal(c["diff"]) for c in custody), Decimal(0))

    dates = [_month_end(today, -k) for k in range(TREND_MONTHS - 1, 0, -1)] + [today]
    trend = net_worth_series(ledger, dates)
    unconverted: Balances = defaultdict(Decimal)
    for account, units in balances.items():
        for currency, n in units.items():
            if _value(ledger, currency, n, today) is None:
                unconverted[currency] += n

    return {
        "currency": ledger.currency,
        "as_of": today.isoformat(),
        "net_worth": _fmt(net),
        "assets": _fmt(assets),
        "liabilities": _fmt(liabilities),
        "change": {"since": dates[-2].isoformat(), "amount": _fmt(net - trend[-2])},
        "trend": [{"date": d.isoformat(), "net_worth": _fmt(v)} for d, v in zip(dates, trend)],
        "unconverted": [{"currency": c, "units": str(n)} for c, n in sorted(unconverted.items()) if n],
        "sides": sides,
        "custody": custody,
    }


def _side(ledger: Ledger, root: str, balances: dict[str, Balances], today: date) -> list[dict]:
    sign = 1 if root == "Assets" else -1
    table = ledger.config.groups[root]
    # 分组 → 子项 → 币种 → 数量
    tree: dict[str, dict[str, Balances]] = defaultdict(lambda: defaultdict(lambda: defaultdict(Decimal)))
    members: dict[str, set[str]] = defaultdict(set)  # 子项 → 归并进来的、余额不为零的科目
    for account, units in balances.items():
        parts = account.split(":")
        if parts[0] != root or ledger.config.custody_holder(account):
            continue
        group = ":".join(parts[:2])
        single = (g := table.get(parts[1] if len(parts) > 1 else "")) is not None and g.single
        child = account if single else ":".join(parts[:3])
        for currency, n in units.items():
            tree[group][child][currency] += n * sign
        if any(units.values()):
            members[child].add(account)

    groups = []
    for group, children in tree.items():
        key = group.split(":")[-1]
        name = _meta_name(ledger, group) or (g.name if (g := table.get(key)) else key)
        kids = []
        for child, units in children.items():
            units = {c: n for c, n in units.items() if n}
            if not units:
                continue  # 余额为零的不列
            holdings = [
                {"currency": c, "units": str(n), "value": _fmt(v) if (v := _value(ledger, c, n, today)) is not None else None}
                for c, n in sorted(units.items())
                if c != ledger.currency
            ]
            amount = sum((v for c, n in units.items() if (v := _value(ledger, c, n, today)) is not None), Decimal(0))
            brand = ledger.account_brand(child)
            kids.append(
                {
                    "account": child,
                    "name": name if child == group else _child_name(ledger, child),
                    "amount": amount,
                    "holdings": holdings,
                    "brand": brand.to_json() if brand else None,
                    # 这一行合并了下面的子科目（电脑端在科目后写「:*」）
                    "merged": any(a != child for a in members[child]),
                }
            )
        if not kids:
            continue
        kids.sort(key=lambda k: (-k["amount"], k["name"]))
        total = sum((k["amount"] for k in kids), Decimal(0))
        groups.append(
            {
                "account": group,
                "key": key,
                "name": name,
                "amount": total,
                "children": [{**k, "amount": _fmt(k["amount"])} for k in kids],
            }
        )

    order = list(table)
    groups.sort(key=lambda g: (order.index(g["key"]) if g["key"] in order else len(order), -g["amount"]))
    return [{**g, "amount": _fmt(g["amount"])} for g in groups]


def _custody(ledger: Ledger, balances: dict[str, Balances], today: date) -> list[dict]:
    """每人一行：代管资金（资产）、代管款（负债，取反）和两者的差额。两边都是零的人不列。"""
    # 人 → 资产各科目，负债合在一起记作 "Liabilities" → 换算后的金额，负债取反
    people: dict[str, dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    for account, units in balances.items():
        person = ledger.config.custody_holder(account)  # 如 Custody:Alice
        if not person:
            continue
        amount = sum((v for c, n in units.items() if (v := _value(ledger, c, n, today)) is not None), Decimal(0))
        if account.startswith("Assets:"):
            people[person][account] += amount
        else:
            people[person]["Liabilities"] -= amount

    def side(account: str, amount: Decimal) -> dict:
        return {"account": account, "name": _child_name(ledger, account), "amount": _fmt(amount)}

    out = []
    for person, amounts in sorted(people.items()):
        liabilities = amounts.pop("Liabilities", Decimal(0))
        kids = sorted(((a, n) for a, n in amounts.items() if n), key=lambda x: (-x[1], x[0]))
        assets = sum((n for _, n in kids), Decimal(0))
        if not assets and not liabilities:
            continue
        out.append(
            {
                "key": person.split(":")[-1] if ":" in person else "",
                "assets": {
                    **side(f"Assets:{person}", assets),
                    "children": [
                        {**side(a, n), "brand": b.to_json() if (b := ledger.account_brand(a)) else None}
                        for a, n in kids
                    ],
                },
                "liabilities": side(f"Liabilities:{person}", liabilities),
                "diff": _fmt(assets - liabilities),
            }
        )
    return out


def _meta_name(ledger: Ledger, account: str) -> str | None:
    meta = ledger.accounts.get(account, {}).get("meta") or {}
    return str(meta["name"]) if meta.get("name") else None


def _child_name(ledger: Ledger, account: str) -> str:
    """name: 元数据；信用卡按银行合并，用 bank-name: 或银行代码对应的中文名（同首页额度）；其余同流水。"""
    if name := _meta_name(ledger, account):
        return name
    config = ledger.config
    if config.is_credit_card(account) and config.credit_card_bank(account) == account:
        meta = ledger.accounts.get(account, {}).get("meta") or {}
        code = account.split(":")[-1]
        return str(meta.get("bank-name") or config.banks.get(code, code))
    return ledger.account_name(account)


def _value(ledger: Ledger, currency: str, number: Decimal, on: date) -> Decimal | None:
    """换成主货币；没有 on 当天或以前的价格时返回 None。"""
    if currency == ledger.currency:
        return number
    _, rate = prices.get_price(ledger.price_map, (currency, ledger.currency), on)
    return number * rate if rate is not None else None


def net_worth_series(ledger: Ledger, dates: list[date]) -> list[Decimal]:
    """每个日期当天结束时的净资产，按那天的价格换算；dates 要从早到晚。"""
    totals: Balances = defaultdict(Decimal)
    txns = sorted(ledger.txns, key=lambda t: t.entry.date)
    out, i = [], 0
    for d in dates:
        while i < len(txns) and txns[i].entry.date <= d:
            for p in txns[i].entry.postings:
                if p.account.split(":")[0] in SIDES.values() and p.units and p.units.number is not None:
                    totals[p.units.currency] += p.units.number
            i += 1
        values = (_value(ledger, c, n, d) for c, n in totals.items())
        out.append(sum((v for v in values if v is not None), Decimal(0)))
    return out


def _month_end(today: date, months: int) -> date:
    """往前（months 为负）数几个月的那个月最后一天。"""
    y, m = divmod(today.year * 12 + today.month - 1 + months + 1, 12)
    return date(y, m + 1, 1) - timedelta(days=1)
