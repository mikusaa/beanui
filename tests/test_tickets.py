from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient

from beanui.app import create_app
from beanui.tickets import ticket_json

TRAIN = {"train": "D1234", "from": "青石", "to": "白沙", "depart": "2026-11-07 18:19"}


def test_needs_all_required_keys():
    assert ticket_json(TRAIN, refund=False)["train"] == "D1234"
    for key in TRAIN:
        assert ticket_json({k: v for k, v in TRAIN.items() if k != key}, refund=False) is None
    assert ticket_json({**TRAIN, "depart": "2026-11-07"}, refund=False) is None
    assert ticket_json({**TRAIN, "depart": "11-07 18:19"}, refund=False) is None


def test_arrive_and_minutes():
    same_day = ticket_json({**TRAIN, "arrive": "20:39"}, refund=False)
    assert (same_day["arrive"], same_day["minutes"]) == ("2026-11-07 20:39", 140)
    next_day = ticket_json({**TRAIN, "arrive": "2026-11-08 06:10"}, refund=False)
    assert (next_day["arrive"], next_day["minutes"]) == ("2026-11-08 06:10", 711)
    # 只写时刻又早于开车：第二天到
    assert ticket_json({**TRAIN, "arrive": "06:10"}, refund=False)["arrive"] == "2026-11-08 06:10"
    for arrive in (None, "", "晚上"):
        t = ticket_json({**TRAIN, "arrive": arrive}, refund=False)
        assert (t["arrive"], t["minutes"]) == (None, None)


def test_optional_keys():
    t = ticket_json(TRAIN, refund=False)
    assert (t["seat"], t["tickets"], t["fee"]) == (None, None, None)
    t = ticket_json({**TRAIN, "seat": "二等座 05车12F", "tickets": Decimal(2), "fee": Decimal("14.3")}, refund=True)
    assert (t["seat"], t["tickets"], t["fee"], t["refund"]) == ("二等座 05车12F", 2, "14.30", True)
    assert ticket_json({**TRAIN, "tickets": Decimal(1)}, refund=False)["tickets"] is None


def test_journal_and_detail_carry_ticket(tmp_path):
    (tmp_path / "main.bean").write_text(
        'option "operating_currency" "CNY"\n'
        "2026-01-01 open Assets:Card\n2026-01-01 open Expenses:Transport:Intercity\n\n"
        '2026-10-30 * "铁路12306" "11-07 D1234 青石 → 白沙"\n'
        '  train: "D1234"\n  from: "青石"\n  to: "白沙"\n  depart: "2026-11-07 18:19"\n  arrive: "20:39"\n  tickets: 2\n'
        "  Assets:Card  -286.00 CNY\n  Expenses:Transport:Intercity\n\n"
        '2026-10-31 * "铁路12306" "退 11-07 D1234"\n'
        '  train: "D1234"\n  from: "青石"\n  to: "白沙"\n  depart: "2026-11-07 18:19"\n  arrive: "20:39"\n  fee: 14.30\n'
        "  Assets:Card  271.70 CNY\n  Expenses:Transport:Intercity\n\n"
        '2026-10-31 * "铁路12306" "火车票"\n'
        "  Assets:Card  -50.00 CNY\n  Expenses:Transport:Intercity\n"
    )
    client = TestClient(create_app(tmp_path / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 10, 31)))
    rows = [t for d in client.get("/api/journal").json()["days"] for t in d["items"]]
    plain, refund, ticket = rows
    assert plain["ticket"] is None
    assert (refund["amount"], refund["ticket"]["refund"], refund["ticket"]["fee"]) == ("271.70", True, "14.30")
    assert ticket["ticket"] == {
        "train": "D1234",
        "from": "青石",
        "to": "白沙",
        "depart": "2026-11-07 18:19",
        "arrive": "2026-11-07 20:39",
        "minutes": 140,
        "seat": None,
        "tickets": 2,
        "fee": None,
        "refund": False,
    }
    assert client.get(f"/api/txn/{ticket['id']}").json()["ticket"] == ticket["ticket"]
