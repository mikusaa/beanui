"""票：交易上写了某种票的元数据时，整理成界面画票要的样子。

车票要 train、from、to、depart，门票要 attraction、visit。车票的四个键写齐了就只按车票算，
开车时间写坏了照普通交易，不改当门票。
元数据的写法见 README「车票和门票」。缺必填的键或时间写不对，就当普通交易，不报错。
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

TRAIN = ("train", "from", "to", "depart")
ATTRACTION = ("attraction", "visit")
WHEN = "%Y-%m-%d %H:%M"
DAY = "%Y-%m-%d"


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


def _visit(text: str) -> str | None:
    """入园日期；预约了时段的带开始时刻。"""
    if when := _when(text):
        return when.strftime(WHEN)
    try:
        return datetime.strptime(text, DAY).strftime(DAY)
    except ValueError:
        return None


def _decimal(value) -> Decimal | None:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _text(meta: dict, key: str) -> str | None:
    return str(meta[key]).strip() if meta.get(key) else None


def _shared(meta: dict, refund: bool) -> dict:
    """各种票都有的：张数、手续费、是不是退票。"""
    tickets = _decimal(meta.get("tickets")) if meta.get("tickets") is not None else None
    fee = _decimal(meta.get("fee")) if meta.get("fee") is not None else None
    return {
        # 一张时不写；写了 1 也当没写
        "tickets": int(tickets) if tickets is not None and tickets > 1 else None,
        "fee": f"{fee:.2f}" if fee else None,
        "refund": refund,
    }


def _train(meta: dict, refund: bool) -> dict | None:
    depart = _when(_text(meta, "depart"))
    if depart is None:
        return None
    arrive = _arrive(_text(meta, "arrive"), depart) if meta.get("arrive") else None
    return {
        "kind": "train",
        "train": _text(meta, "train"),
        "from": _text(meta, "from"),
        "to": _text(meta, "to"),
        "depart": depart.strftime(WHEN),
        "arrive": arrive.strftime(WHEN) if arrive else None,
        "minutes": int((arrive - depart).total_seconds() // 60) if arrive else None,
        "seat": _text(meta, "seat"),
        **_shared(meta, refund),
    }


def _attraction(meta: dict, refund: bool) -> dict | None:
    visit = _visit(_text(meta, "visit"))
    if visit is None:
        return None
    return {
        "kind": "attraction",
        "attraction": _text(meta, "attraction"),
        "visit": visit,
        "item": _text(meta, "item"),
        **_shared(meta, refund),
    }


def ticket_json(meta: dict, refund: bool) -> dict | None:
    """refund：这笔是退票（金额是退回的钱），由调用方按金额方向判断。"""
    if all(meta.get(k) for k in TRAIN):
        return _train(meta, refund)
    if all(meta.get(k) for k in ATTRACTION):
        return _attraction(meta, refund)
    return None
