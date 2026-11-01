import shutil
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from beanui.accounts import _month_end
from beanui.app import create_app

from .conftest import FIXTURES

D = Decimal


def groups(body, side):
    return {g["key"]: g for g in body["sides"][side]}


def children(group):
    return [(k["name"], k["amount"]) for k in group["children"]]


def test_totals_and_net_worth(client):
    body = client.get("/api/accounts").json()
    assert (body["currency"], body["as_of"]) == ("CNY", "2026-10-31")
    assert (body["assets"], body["liabilities"], body["net_worth"]) == ("17853.07", "5448.42", "12404.65")
    for side in ("assets", "liabilities"):
        assert sum(D(g["amount"]) for g in body["sides"][side]) == D(body[side])


def test_asset_groups(client):
    body = client.get("/api/accounts").json()
    # 按表里的顺序：银行、投资、钱包、应收、预付
    assert [g["name"] for g in body["sides"]["assets"]] == ["银行", "投资", "数字钱包", "应收", "预付"]
    a = groups(body, "assets")
    # 银行每个账户单列，从大到小；没有 name: 的退回末段
    assert children(a["Bank"]) == [("招行 1234", "8101.00"), ("BOC 8765", "3600.27")]
    assert a["Bank"]["children"][0]["account"] == "Assets:Bank:CMB:1234"
    assert a["Bank"]["children"][0]["brand"]["id"] == "cmb"
    assert children(a["Receivables"]) == [("朋友", "800.00")]
    assert a["Digital"]["children"][0]["brand"]["id"] == "alipay"


def test_liability_groups_are_positive_debts(client):
    body = client.get("/api/accounts").json()
    assert [g["name"] for g in body["sides"]["liabilities"]] == ["信用卡", "应付", "消费信贷"]
    lia = groups(body, "liabilities")
    # 信用卡按银行合并，银行名同首页额度；十一月的 300 分期不算
    assert children(lia["CreditCard"]) == [("招商银行", "4200.00"), ("中国银行", "500.00"), ("工商银行", "100.00")]
    assert lia["CreditCard"]["children"][0]["account"] == "Liabilities:CreditCard:CMB"
    # 白条已经还清，余额为零的不列
    assert children(lia["Credit"]) == [("花呗", "48.42")]
    assert children(lia["Payables"]) == [("Family", "600.00")]


def test_merged_rows_are_marked(client):
    body = client.get("/api/accounts").json()
    merged = {k["account"]: k["merged"] for side in ("assets", "liabilities") for g in body["sides"][side] for k in g["children"]}
    # 单列的银行卡、本身记账的科目不算合并；黄金、信用卡按前三段收起了下面的子科目
    assert merged["Assets:Bank:CMB:1234"] is False
    assert merged["Assets:Digital:Alipay"] is False
    assert merged["Assets:Investments:Gold"] is True
    assert merged["Liabilities:CreditCard:CMB"] is True


def test_prices_convert_and_missing_prices_are_left_out(client):
    body = client.get("/api/accounts").json()
    inv = groups(body, "assets")["Investments"]
    # 黄金按 10-30 的 530 换算，11-15 的价格还没到
    gold, crypto = inv["children"]
    assert (gold["name"], gold["amount"]) == ("Gold", "5300.00")
    assert gold["holdings"] == [{"currency": "GOLD", "units": "10", "value": "5300.00"}]
    # USDC 没有价格：照列持仓，不计入金额和净资产
    assert (crypto["name"], crypto["amount"]) == ("Crypto", "0.00")
    assert crypto["holdings"] == [{"currency": "USDC", "units": "20.00", "value": None}]
    assert body["unconverted"] == [{"currency": "USDC", "units": "20.00"}]


def test_trend_and_change_since_last_month_end(client):
    body = client.get("/api/accounts").json()
    trend = body["trend"]
    assert len(trend) == 12
    assert (trend[0]["date"], trend[-2]["date"], trend[-1]["date"]) == ("2025-11-30", "2026-09-30", "2026-10-31")
    assert trend[-1]["net_worth"] == body["net_worth"]
    # 九月底黄金按 520：-5800 + 5600 + 100 + 5200 + 800 - (299 + 2500 + 4200 + 100 + 600)
    assert trend[-2]["net_worth"] == "-1799.00"
    assert trend[8] == {"date": "2026-07-31", "net_worth": "5100.00"}  # 七月黄金按 500
    # 十月：工资 14200、优惠 1.35、支出 97.70、黄金涨 100
    assert body["change"] == {"since": "2026-09-30", "amount": "14203.65"}


def test_month_end():
    assert _month_end(date(2026, 10, 31), -1) == date(2026, 9, 30)
    assert _month_end(date(2026, 3, 15), -1) == date(2026, 2, 28)
    assert _month_end(date(2026, 1, 10), -1) == date(2025, 12, 31)
    assert _month_end(date(2026, 10, 31), -11) == date(2025, 11, 30)


def test_group_and_child_names_from_metadata(tmp_path):
    shutil.copytree(FIXTURES / "ledger", tmp_path / "ledger")
    accounts = tmp_path / "ledger" / "accounts.bean"
    accounts.write_text(
        accounts.read_text(encoding="utf-8")
        + '2020-01-01 open Assets:Bank\n  name: "银行卡"\n'
        + '2020-01-01 open Assets:Investments:Gold\n  name: "黄金"\n',
        encoding="utf-8",
    )
    app = create_app(tmp_path / "ledger" / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 10, 31))
    a = groups(TestClient(app).get("/api/accounts").json(), "assets")
    assert a["Bank"]["name"] == "银行卡"
    assert a["Investments"]["children"][0]["name"] == "黄金"


def test_earlier_day_ignores_later_transactions():
    app = create_app(FIXTURES / "ledger" / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 9, 30))
    body = TestClient(app).get("/api/accounts").json()
    assert body["net_worth"] == "-1799.00"
    assert body["change"]["since"] == "2026-08-31" and body["change"]["amount"] == "-99.00"  # 白条 299，黄金涨 200
    a = groups(body, "assets")
    assert children(a["Digital"]) == [("Alipay", "100.00")]
    assert "Prepaid" not in a  # 腾讯云十月才充值


def test_custody_is_left_out_of_both_sides(client):
    body = client.get("/api/accounts").json()
    # 小明的 3000 不在资产、负债两边的分组和合计里，净资产不变
    assert (body["assets"], body["liabilities"], body["net_worth"]) == ("17853.07", "5448.42", "12404.65")
    for side in ("assets", "liabilities"):
        assert "Custody" not in groups(body, side)
        assert all(":Custody" not in k["account"] for g in body["sides"][side] for k in g["children"])
    assert body["custody"] == [
        {
            "key": "Xiaoming",
            "assets": {
                "account": "Assets:Custody:Xiaoming",
                "name": "小明代管资金",
                "amount": "3000.00",
                "children": [
                    {"account": "Assets:Custody:Xiaoming:Alipay", "name": "Alipay", "amount": "3000.00", "brand": {"id": "alipay", "name": "支付宝", "logo": "/logos/alipay.svg", "fit": "tile"}}
                ],
            },
            "liabilities": {"account": "Liabilities:Custody:Xiaoming", "name": "小明代管款", "amount": "3000.00"},
            "diff": "0.00",
        }
    ]


def test_custody_difference_stays_in_net_worth(tmp_path):
    shutil.copytree(FIXTURES / "ledger", tmp_path / "ledger")
    shutil.copy(FIXTURES / "custody-diff.bean", tmp_path / "ledger" / "data")
    app = create_app(tmp_path / "ledger" / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 10, 31))
    body = TestClient(app).get("/api/accounts").json()
    # 两边合计不变；外公的利息只记了资产一边，多出的 5 元算进净资产
    assert (body["assets"], body["liabilities"], body["net_worth"]) == ("17853.07", "5448.42", "12409.65")
    assert body["trend"][-1]["net_worth"] == body["net_worth"]
    grandpa, xiaoming = body["custody"]
    assert xiaoming["key"] == "Xiaoming" and xiaoming["diff"] == "0.00"
    # 没有 name: 时退回末段
    assert (grandpa["key"], grandpa["assets"]["name"], grandpa["liabilities"]["name"]) == ("Grandpa", "Grandpa", "Grandpa")
    assert (grandpa["assets"]["amount"], grandpa["liabilities"]["amount"], grandpa["diff"]) == ("1005.00", "1000.00", "5.00")
    assert grandpa["assets"]["children"][0]["name"] == "Bank"


def test_config_overrides_conventions(tmp_path):
    (tmp_path / "config.yaml").write_text(
        "groups:\n"
        "  Assets:\n"
        "    Digital: { name: 钱包, single: true }\n"
        "    Bank: 银行卡\n"
        "banks:\n"
        "  ICBC: 工行\n"
        "custody: null\n",
        encoding="utf-8",
    )
    app = create_app(FIXTURES / "ledger" / "main.bean", config_dir=tmp_path, web_dist=None, today=lambda: date(2026, 10, 31))
    client = TestClient(app)
    body = client.get("/api/accounts").json()
    a = groups(body, "assets")
    # 照配置的顺序排，表里没写的（投资、预付）排在后面
    assert [g["key"] for g in body["sides"]["assets"]][:2] == ["Digital", "Bank"]
    assert (a["Digital"]["name"], a["Bank"]["name"]) == ("钱包", "银行卡")
    assert a["Investments"]["name"] == "Investments"  # 整张表替换，没写的组显示英文末段
    # 不单列代管：小明的钱回到资产、负债两边
    assert body["custody"] == [] and "Custody" in a
    assert "Custody" in groups(body, "liabilities")
    # 银行代码表在默认表上增改：工行换了名字，中行仍用默认，招行账户上写了 bank-name:
    names = {r["id"].split(":")[-1]: r["bank"] for r in client.get("/api/overview").json()["credit"]["rows"]}
    assert (names["ICBC"], names["BOC"], names["CMB"]) == ("工行", "中国银行", "招商银行")


def test_config_rejects_unknown_keys(tmp_path):
    (tmp_path / "config.yaml").write_text("group: {}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="group"):
        create_app(FIXTURES / "ledger" / "main.bean", config_dir=tmp_path, web_dist=None)
