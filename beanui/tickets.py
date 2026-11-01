"""车票：交易上写了 train、from、to、depart 元数据时，整理成界面画车票要的样子。

元数据的写法见 README「车票」。缺必填的键或开车时间写不对，就当普通交易，不报错。
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

REQUIRED = ("train", "from", "to", "depart")
WHEN = "%Y-%m-%d %H:%M"


def _when(text: str) -> datetime | None:
    try:
        return datetime.strptime(text, WHEN)
    except ValueError:
        return None


def _arrive(text: str, depart: datetime) -> datetime | None:
    """当天到只写时刻；只写时刻又早于开车时间的，当成第二天到。"""
    if when := _when(text):
        return when
    try:
        t = datetime.strptime(text, "%H:%M")
    except ValueError:
        return None
    when = depart.replace(hour=t.hour, minute=t.minute)
    return when + timedelta(days=1) if when < depart else when


def _decimal(value) -> Decimal | None:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def ticket_json(meta: dict, refund: bool) -> dict | None:
    """refund：这笔是退票（金额是退回的钱），由调用方按金额方向判断。"""
    if not all(meta.get(k) for k in REQUIRED):
        return None
    depart = _when(str(meta["depart"]).strip())
    if depart is None:
        return None
    arrive = _arrive(str(meta["arrive"]).strip(), depart) if meta.get("arrive") else None
    tickets = _decimal(meta.get("tickets")) if meta.get("tickets") is not None else None
    fee = _decimal(meta.get("fee")) if meta.get("fee") is not None else None
    return {
        "train": str(meta["train"]).strip(),
        "from": str(meta["from"]).strip(),
        "to": str(meta["to"]).strip(),
        "depart": depart.strftime(WHEN),
        "arrive": arrive.strftime(WHEN) if arrive else None,
        "minutes": int((arrive - depart).total_seconds() // 60) if arrive else None,
        "seat": str(meta["seat"]).strip() if meta.get("seat") else None,
        # 一张时不写；写了 1 也当没写
        "tickets": int(tickets) if tickets is not None and tickets > 1 else None,
        "fee": f"{fee:.2f}" if fee else None,
        "refund": refund,
    }
