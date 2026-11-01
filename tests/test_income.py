import shutil
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from beanui.app import create_app

from .conftest import FIXTURES

D = Decimal


@pytest.fixture
def extra(tmp_path):
    shutil.copytree(FIXTURES / "ledger", tmp_path / "ledger")
    shutil.copy(FIXTURES / "income-extra.bean", tmp_path / "ledger" / "data")
    app = create_app(tmp_path / "ledger" / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 10, 31))
    return TestClient(app)


def _rows(side):
    return {g["account"]: g for g in side}


def test_income_defaults_to_this_year_and_stops_at_today(client):
    body = client.get("/api/income").json()
    assert (body["time"], body["start"], body["end"], body["capped"]) == ("year", "2026-01-01", "2026-10-31", True)
    # 十一月、十二月的宽带分期是预先记的，不算
    assert (body["income"], body["expense"], body["net"], body["savings_rate"]) == ("14200.00", "7196.70", "7003.30", 49.3)
    assert body["years"] == [2026]


def test_income_matches_overview(client):
    for time in ("week", "month", "last-month", "3months", "year", "2026-08"):
        inc = client.get("/api/income", params={"time": time}).json()
        ov = client.get("/api/overview", params={"time": time}).json()
        assert (inc["start"], inc["end"], inc["income"], inc["expense"]) == (ov["start"], ov["end"], ov["income"], ov["expense"])
        assert inc["compare"]["expense"] == ov["compare"]["expense"]
        assert inc["compare"]["expense_change"] == ov["compare"]["change"]
        # 首页的分类是前三段，收支表把它们按第二段分组，子类合起来就是首页的分类
        cats = {c["account"]: c["amount"] for c in ov["categories"]}
        kids = {k["account"]: k["amount"] for g in inc["sides"]["expense"] for k in (g["children"] or [g])}
        assert kids == cats


def test_income_groups_add_up(client):
    body = client.get("/api/income").json()
    for side, total in (("income", body["income"]), ("expense", body["expense"])):
        groups = body["sides"][side]
        assert sum(D(g["amount"]) for g in groups) == D(total)
        for g in groups:
            if g["children"]:
                assert sum(D(c["amount"]) for c in g["children"]) == D(g["amount"])
    expense = body["sides"]["expense"]
    # 组和组内都从大到小；父科目没有 name: 时用英文末段
    assert [(g["account"], g["name"], g["amount"]) for g in expense] == [
        ("Expenses:Housing", "Housing", "4200.00"),
        ("Expenses:Transport", "Transport", "2600.00"),
        ("Expenses:Tech", "Tech", "348.50"),
        ("Expenses:Entertainment", "Entertainment", "30.00"),
        ("Expenses:Food", "Food", "18.20"),
    ]
    tech = _rows(expense)["Expenses:Tech"]
    assert [(c["name"], c["amount"]) for c in tech["children"]] == [("Device", "299.00"), ("Homelab", "49.50")]
    assert tech["group"] == "Tech"
    assert [(g["account"], g["name"], g["children"]) for g in body["sides"]["income"]] == [("Income:Salary", "工资", [])]


def test_income_compare_last_month(client):
    body = client.get("/api/income", params={"time": "2026-09"}).json()
    assert (body["capped"], body["start"], body["end"]) == (False, "2026-09-01", "2026-09-30")
    c = body["compare"]
    assert (c["start"], c["end"], c["income"], c["expense"], c["net"]) == ("2026-08-01", "2026-08-31", "0.00", "6800.00", "-6800.00")
    assert (c["income_change"], c["expense_change"], c["savings_rate"]) == (None, -95.6, None)
    tech = _rows(body["sides"]["expense"])["Expenses:Tech"]
    # 上一段没有这一类时变化为空
    assert (tech["amount"], tech["previous"], tech["change"]) == ("299.00", "0.00", None)


def test_income_without_compare_and_bad_time(client):
    body = client.get("/api/income", params={"time": "all"}).json()
    assert body["compare"] is None
    assert all(g["previous"] is None and g["change"] is None for g in body["sides"]["expense"])
    assert client.get("/api/income", params={"time": "bogus"}).status_code == 400


def test_income_months_end_with_range(client):
    months = client.get("/api/income", params={"time": "2026-08"}).json()["months"]
    assert [m["month"] for m in months][0] == "2025-09" and months[-1] == {"month": "2026-08", "income": "0.00", "expense": "6800.00"}
    this = client.get("/api/income", params={"time": "week"}).json()["months"]
    assert this[-1] == {"month": "2026-10", "income": "14200.00", "expense": "97.70"}


def test_income_groups_names_and_depth(extra):
    body = extra.get("/api/income").json()
    # 记在转账里的投资收益（卖基金）不算，和首页一致；分红、利息是收入
    assert body["income"] == "14253.21"
    income = _rows(body["sides"]["income"])
    assert list(income) == ["Income:Salary", "Income:Investments", "Income:Financial"]
    inv = income["Income:Investments"]
    assert (inv["name"], inv["amount"]) == ("Investments", "50.00")
    assert [(c["account"], c["name"]) for c in inv["children"]] == [("Income:Investments:CapitalGains", "资本利得")]
    # 四段的科目并进前三段
    assert [c["account"] for c in income["Income:Financial"]["children"]] == ["Income:Financial:Interest"]

    expense = _rows(body["sides"]["expense"])
    food = expense["Expenses:Food"]
    # 二级科目有 name: 时用它；直接记在二级科目上的也列成一类
    assert (food["name"], food["amount"]) == ("饮食", "50.20")
    assert [(c["account"], c["name"], c["amount"]) for c in food["children"]] == [
        ("Expenses:Food:Meals", "餐饮", "38.20"),
        ("Expenses:Food", "饮食", "12.00"),
    ]
    # 只记在二级科目本身时不列子类
    hobbies = expense["Expenses:Hobbies"]
    assert (hobbies["amount"], hobbies["children"]) == ("88.00", [])


def test_income_compare_with_last_year(extra):
    body = extra.get("/api/income").json()
    c = body["compare"]
    # 今年到 10-31 比去年到 10-31：去年十二月的模型不在里面
    assert (c["start"], c["end"], c["income"], c["expense"]) == ("2025-01-01", "2025-10-31", "10000.00", "36.40")
    assert c["income_change"] == 42.5 and c["savings_rate"] == 99.6
    food = _rows(body["sides"]["expense"])["Expenses:Food"]
    assert (food["previous"], food["change"]) == ("36.40", 37.9)
    meals, own = food["children"]
    assert (meals["previous"], meals["change"]) == ("36.40", 4.9)
    assert (own["previous"], own["change"]) == ("0.00", None)
    salary = _rows(body["sides"]["income"])["Income:Salary"]
    assert (salary["previous"], salary["change"]) == ("10000.00", 42.0)
    assert body["years"] == [2026, 2025]


def test_income_past_year(extra):
    body = extra.get("/api/income", params={"time": "2025"}).json()
    assert (body["start"], body["end"], body["capped"]) == ("2025-01-01", "2025-12-31", False)
    assert (body["income"], body["expense"]) == ("10000.00", "96.40")
    assert body["compare"]["start"] == "2024-01-01" and body["compare"]["end"] == "2024-12-31"
    assert body["months"][-1] == {"month": "2025-12", "income": "0.00", "expense": "60.00"}
