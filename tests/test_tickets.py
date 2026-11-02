from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient

from beanui.app import create_app
from beanui.tickets import ticket_json

TRAIN = {"train": "D1234", "from": "青石", "to": "白沙", "depart": "2026-11-07 18:19"}
SPOT = {"attraction": "青石山风景区", "visit": "2026-11-06"}


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


def test_attraction_needs_name_and_visit():
    t = ticket_json(SPOT, refund=False)
    assert (t["kind"], t["attraction"], t["visit"]) == ("attraction", "青石山风景区", "2026-11-06")
    for key in SPOT:
        assert ticket_json({k: v for k, v in SPOT.items() if k != key}, refund=False) is None
    for visit in ("11-06", "2026-11-06 上午", "明天"):
        assert ticket_json({**SPOT, "visit": visit}, refund=False) is None
    # 预约了入园时段的带开始时刻
    assert ticket_json({**SPOT, "visit": "2026-11-09 07:30"}, refund=False)["visit"] == "2026-11-09 07:30"


def test_attraction_optional_keys():
    t = ticket_json(SPOT, refund=False)
    assert (t["item"], t["tickets"], t["fee"], t["refund"]) == (None, None, None, False)
    t = ticket_json({**SPOT, "item": " 门票 + 上行索道 ", "tickets": Decimal(2), "fee": Decimal("8")}, refund=True)
    assert (t["item"], t["tickets"], t["fee"], t["refund"]) == ("门票 + 上行索道", 2, "8.00", True)


def test_train_wins_when_both_written():
    assert ticket_json({**TRAIN, **SPOT}, refund=False)["kind"] == "train"
    # 车票的键写齐了就只看车票：开车时间写坏了照普通交易，不改画成门票
    assert ticket_json({**TRAIN, "depart": "坏的", **SPOT}, refund=False) is None


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
        "kind": "train",
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


def test_journal_carries_attraction(tmp_path):
    (tmp_path / "main.bean").write_text(
        'option "operating_currency" "CNY"\n'
        "2026-01-01 open Assets:Card\n2026-01-01 open Expenses:Travel:Attractions\n\n"
        '2026-10-30 * "白沙旅行" "青石山 门票 2 张"\n'
        '  attraction: "青石山风景区"\n  visit: "2026-11-06"\n  item: "门票 + 索道"\n  tickets: 2\n'
        "  Assets:Card  -300.00 CNY\n  Expenses:Travel:Attractions\n\n"
        '2026-10-31 * "青石山风景区" "门票"\n'
        "  Assets:Card  -80.00 CNY\n  Expenses:Travel:Attractions\n"
    )
    client = TestClient(create_app(tmp_path / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 10, 31)))
    plain, ticket = [t for d in client.get("/api/journal").json()["days"] for t in d["items"]]
    # 只记在门票科目、没写元数据的照普通交易
    assert plain["ticket"] is None
    assert ticket["ticket"] == {
        "kind": "attraction",
        "attraction": "青石山风景区",
        "visit": "2026-11-06",
        "item": "门票 + 索道",
        "tickets": 2,
        "fee": None,
        "refund": False,
    }
    assert client.get(f"/api/txn/{ticket['id']}").json()["ticket"] == ticket["ticket"]
