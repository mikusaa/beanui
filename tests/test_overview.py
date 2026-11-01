import shutil
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from beanui.app import create_app
from beanui.overview import credit_card_rows, previous_period, read_sync_status, utilization_level

from .conftest import FIXTURES

D = Decimal


def test_overview_this_month(client):
    body = client.get("/api/overview").json()
    assert (body["start"], body["end"]) == ("2026-10-01", "2026-10-31")
    assert (body["expense"], body["income"], body["net"]) == ("97.70", "14200.00", "14102.30")
    assert body["savings_rate"] == 99.3
    # 九月只有一笔 299 的键盘
    assert body["compare"] == {"start": "2026-09-01", "end": "2026-09-30", "expense": "299.00", "change": -67.3}
    assert body["title"] == "示例账本"


def test_overview_categories_add_up_to_expense(client):
    cats = client.get("/api/overview").json()["categories"]
    assert [(c["name"], c["amount"]) for c in cats] == [("Homelab", "49.50"), ("Gaming", "30.00"), ("餐饮", "18.20")]
    assert cats[0]["account"] == "Expenses:Tech:Homelab" and cats[0]["group"] == "Tech"
    assert sum(D(c["amount"]) for c in cats) == D("97.70")


def test_overview_stops_at_today(client):
    # 十一月的分期是预先记的：不算进今年支出，也不出现在最近交易
    body = client.get("/api/overview", params={"time": "year"}).json()
    assert body["end"] == "2026-10-31"
    assert body["expense"] == "7196.70"  # 8 月 6800 + 9 月 299 + 10 月 97.70
    assert body["compare"]["end"] == "2025-10-31" and body["compare"]["change"] is None
    recent = body["recent"]
    assert [t["narration"] for t in recent] == ["月卡", "牛肉饭", "信用卡还款", "散热风扇", "内存条 DDR4"]


def test_overview_other_ranges(client):
    def get(time):
        return client.get("/api/overview", params={"time": time}).json()

    week = get("week")  # 2026-10-31 是周六
    assert (week["start"], week["end"], week["expense"]) == ("2026-10-26", "2026-10-31", "97.70")
    assert week["compare"]["start"] == "2026-10-19" and week["compare"]["change"] is None
    last = get("last-month")
    assert (last["start"], last["end"], last["expense"]) == ("2026-09-01", "2026-09-30", "299.00")
    assert last["compare"] == {"start": "2026-08-01", "end": "2026-08-31", "expense": "6800.00", "change": -95.6}
    assert get("3months")["start"] == "2026-08-01"
    assert get("all")["compare"] is None
    assert get("last-month")["savings_rate"] is None  # 没有收入
    assert client.get("/api/overview", params={"time": "bogus"}).status_code == 400


def test_previous_period_same_point_in_time():
    # 本月到 10-30，比 9-1 到 9-30；月底对不上时取那个月的最后一天
    assert previous_period("month", date(2026, 10, 1), date(2026, 10, 31), True) == (date(2026, 9, 1), date(2026, 10, 1))
    assert previous_period("month", date(2026, 3, 1), date(2026, 4, 1), True) == (date(2026, 2, 1), date(2026, 3, 1))
    assert previous_period("year", date(2028, 1, 1), date(2028, 3, 1), True) == (date(2027, 1, 1), date(2027, 3, 1))
    # 过完的整月比前一整月
    assert previous_period("last-month", date(2026, 9, 1), date(2026, 10, 1), False) == (date(2026, 8, 1), date(2026, 9, 1))
    assert previous_period("2025", date(2025, 1, 1), date(2026, 1, 1), False) == (date(2024, 1, 1), date(2025, 1, 1))
    assert previous_period("2026-03", date(2026, 3, 1), date(2026, 4, 1), False) == (date(2026, 2, 1), date(2026, 3, 1))


def test_credit_in_overview(client):
    credit = client.get("/api/overview", params={"time": "week"}).json()["credit"]
    assert credit["as_of"] == "2026-10-31"
    rows = {r["id"]: r for r in credit["rows"]}
    # 有额度的在前，使用率高的在前；十一月的 300 分期不计入
    assert list(rows) == ["Liabilities:CreditCard:CMB", "Liabilities:CreditCard:BOC", "Liabilities:CreditCard:ICBC"]
    cmb = rows["Liabilities:CreditCard:CMB"]
    assert (cmb["bank"], cmb["limit"], cmb["used"], cmb["available"]) == ("招商银行", "5000.00", "4200.00", "800.00")
    assert (cmb["utilization"], cmb["level"], cmb["brand"]["id"]) == (84.0, "high", "cmb")
    boc = rows["Liabilities:CreditCard:BOC"]
    assert (boc["bank"], boc["cards"], boc["used"], boc["level"]) == ("中国银行", 2, "500.00", "ok")  # 刷 2500、还 2000
    icbc = rows["Liabilities:CreditCard:ICBC"]
    assert (icbc["limit"], icbc["available"], icbc["utilization"], icbc["level"]) == (None, None, None, None)
    assert credit["utilization"] == 31.3  # (4200 + 500) / 15000，没设额度的不算
    assert credit["error"] is None


def test_credit_metadata_error_is_reported(tmp_path):
    shutil.copytree(FIXTURES / "ledger", tmp_path / "ledger")
    accounts = tmp_path / "ledger" / "accounts.bean"
    accounts.write_text(accounts.read_text(encoding="utf-8") + '2020-01-01 open Liabilities:CreditCard:SPDB\n  credit-limit: "lots"\n', encoding="utf-8")
    app = create_app(tmp_path / "ledger" / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 10, 31))
    credit = TestClient(app).get("/api/overview").json()["credit"]
    assert credit["rows"] == [] and "必须是非负" in credit["error"]


# ── 信用卡额度 ──

CMB = "Liabilities:CreditCard:CMB"
ABC = "Liabilities:CreditCard:ABC"


def test_configured_bank_calculates_debt_available_and_utilization():
    [row] = credit_card_rows(
        {CMB: {"bank-name": "招商银行", "credit-limit": D(20000), "card-count": D(2)}}, {CMB: D("-500.00")}
    )
    assert (row["bank"], row["cards"], row["used"], row["available"]) == ("招商银行", 2, D("500.00"), D("19500.00"))
    assert row["utilization"] == 2.5


def test_shared_metadata_on_child_cards_counted_once_and_parent_wins():
    accounts = {
        f"{ABC}:1111": {"credit-limit": D(80000), "card-count": D(2)},
        f"{ABC}:2222": {"credit-limit": D(80000), "card-count": D(2)},
        "Liabilities:Installment:CMB:Phone": {},
    }
    balances = {ABC: D("-45098.98")}
    rows = credit_card_rows(accounts, balances)
    assert len(rows) == 1
    assert (rows[0]["bank"], rows[0]["limit"], rows[0]["cards"], rows[0]["available"]) == ("农业银行", 80000, 2, D("34901.02"))
    accounts[ABC] = {"credit-limit": D(90000)}
    assert credit_card_rows(accounts, balances)[0]["limit"] == 90000


def test_unknown_and_zero_limits_never_fabricate_availability():
    rows = {r["id"]: r for r in credit_card_rows({CMB: {}, ABC: {"credit-limit": D(0)}}, {CMB: D(-100), ABC: D(-20)})}
    assert (rows[CMB]["limit"], rows[CMB]["cards"], rows[CMB]["available"]) == (None, None, None)
    assert rows[ABC]["available"] == -20
    assert all(r["utilization"] is None and r["level"] is None for r in rows.values())


def test_over_limit_and_overpayment_keep_signs():
    accounts = {CMB: {"credit-limit": D(1000)}}
    [over] = credit_card_rows(accounts, {CMB: D(-1705)})
    assert (over["available"], over["utilization"], over["level"]) == (-705, 170.5, "over")
    [credit] = credit_card_rows(accounts, {CMB: D("20.12")})
    assert (credit["used"], credit["available"]) == (D("-20.12"), D("1020.12"))
    [empty] = credit_card_rows(accounts, {})
    assert (empty["used"], empty["available"]) == (0, 1000)
    assert str(empty["used"]) == "0"  # 不是 -0


def test_invalid_or_conflicting_metadata_raises():
    with pytest.raises(ValueError, match="配置不一致"):
        credit_card_rows({f"{ABC}:1111": {"credit-limit": D(80000)}, f"{ABC}:2222": {"credit-limit": D(60000)}}, {})
    for meta in [{"credit-limit": D(-1)}, {"credit-limit": "20000"}, {"card-count": D("1.5")}, {"card-count": True}]:
        with pytest.raises(ValueError, match="必须是非负"):
            credit_card_rows({CMB: meta}, {})


def test_utilization_levels_match_dashboard_thresholds():
    assert [utilization_level(v) for v in (None, 0, 49.9, 50, 79.9, 80, 99.9, 100, 170)] == [
        None, "ok", "ok", "warn", "warn", "high", "high", "over", "over",
    ]  # fmt: skip


# ── 同步状态 ──

def test_sync_status_missing(tmp_path, client):
    assert read_sync_status(tmp_path) is None
    (tmp_path / ".git").mkdir()
    assert read_sync_status(tmp_path) is None
    assert client.get("/api/overview").json()["sync"] is None


def test_sync_status_lines(tmp_path):
    (tmp_path / ".git").mkdir()
    status = tmp_path / ".git" / "sync-status"
    status.write_text("ok 2026-10-31T02:10:00Z 6135fee\n")
    assert read_sync_status(tmp_path) == {"state": "ok", "time": "2026-10-31T02:10:00+00:00", "commit": "6135fee", "message": None,
                                         "can_sync": False, "pending": False}
    status.write_text("error 2026-10-31T02:11:00Z fatal: unable to access 'https://example.com/': timeout \n")
    s = read_sync_status(tmp_path)
    assert (s["state"], s["time"], s["commit"]) == ("error", "2026-10-31T02:11:00+00:00", None)
    assert s["message"] == "fatal: unable to access 'https://example.com/': timeout"
    for junk in ("", "ok", "ok yesterday abc", "maybe 2026-10-31T02:10:00Z x"):
        status.write_text(junk)
        assert read_sync_status(tmp_path) is None


def test_sync_status_in_api(tmp_path):
    shutil.copytree(FIXTURES / "ledger", tmp_path / "ledger")
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "sync-status").write_text("ok 2026-10-31T02:10:00Z 6135fee\n")
    app = create_app(tmp_path / "ledger" / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 10, 31))
    c = TestClient(app)
    assert c.get("/api/overview").json()["sync"]["commit"] == "6135fee"
    assert c.get("/api/status").json()["sync"]["state"] == "ok"


# ── 电脑端概览 ──


def test_overview_monthly_income_and_expense(client):
    months = client.get("/api/overview", params={"time": "week"}).json()["months"]
    # 近 12 个月，从早到晚，不随时间范围变；只算到今天，十一月的分期不在里面
    assert [m["month"] for m in months] == [f"2025-{m}" for m in ("11", "12")] + [f"2026-{m:02d}" for m in range(1, 11)]
    by = {m["month"]: (m["income"], m["expense"]) for m in months}
    assert by["2026-08"] == ("0.00", "6800.00")
    assert by["2026-09"] == ("0.00", "299.00")
    assert by["2026-10"] == ("14200.00", "97.70")  # 和本月的合计一致
    assert by["2025-11"] == ("0.00", "0.00")


def test_monthly_caps_last_month_at_today(tmp_path):
    shutil.copytree(FIXTURES / "ledger", tmp_path / "ledger")
    # 10 月 15 日看：十月只算到 15 日，20 日以后的工资、CPU 不算
    app = create_app(tmp_path / "ledger" / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 10, 15))
    months = TestClient(app).get("/api/overview").json()["months"]
    assert months[-1] == {"month": "2026-10", "income": "0.00", "expense": "0.00"}
    assert months[0]["month"] == "2025-11"


def test_credit_totals(client):
    credit = client.get("/api/overview").json()["credit"]
    # 额度只加有额度的两家：10000 + 5000；已用三家都算：500 + 4200 + 100
    assert (credit["limit"], credit["used"]) == ("15000.00", "4800.00")
    assert (credit["utilization"], credit["level"]) == (31.3, "ok")


def test_overview_recent_count(client):
    assert len(client.get("/api/overview").json()["recent"]) == 5
    recent = client.get("/api/overview", params={"recent": 8}).json()["recent"]
    assert len(recent) == 8
    assert client.get("/api/overview", params={"recent": 0}).status_code == 422
