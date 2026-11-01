from pathlib import Path

import pytest

from beanui.brands import Brands, normalize

BRANDS = Brands.load(Path(__file__).parent / "fixtures" / "config")


def match(text):
    b = BRANDS.match(text)
    return b.id if b else None


def test_normalize_ignores_space_width_case_and_brackets():
    assert normalize(" Ａｐｐ　Store（中国） ") == "appstore中国"


@pytest.mark.parametrize(
    "text, expected",
    [
        ("美团外卖", "meituanwaimai"),
        ("美团", "meituan"),
        ("美团外卖 · 牛肉饭", "meituanwaimai"),
        ("京东白条", "jdfinance"),
        ("京东", "jd"),
        ("京东白条还款", "jdfinance"),
        ("京东外卖", "jd"),
        ("Google AdSense", "adsense"),
        ("Google Adsense", "adsense"),
        ("Google", "google"),
        ("Google Domain", "google"),
    ],
)
def test_longest_alias_wins(text, expected):
    assert match(text) == expected


@pytest.mark.parametrize("text", ["app store", "ＡＰＰ ＳＴＯＲＥ", "Apple App Store", "(App) Store"])
def test_match_after_normalizing(text):
    assert match(text) == "appstore"


def test_no_match():
    assert match("示例公司") is None
    assert match("") is None
    assert match(None) is None


def test_transaction_order_brand_meta_then_game_then_payee_then_narration():
    # brand: 元数据优先
    assert BRANDS.for_transaction({"brand": "jd"}, "淘宝", "").id == "jd"
    # game: 元数据比收付方优先
    assert BRANDS.for_transaction({"game": "Genshin"}, "米哈游", "月卡").id == "genshin"
    # 有收付方时不看摘要
    assert BRANDS.for_transaction({}, "示例公司", "淘宝买的").__class__ is type(None)
    assert BRANDS.for_transaction({}, "淘宝", "京东同款").id == "taobao"
    # 收付方为空才用摘要
    assert BRANDS.for_transaction({}, "", "京东白条还款").id == "jdfinance"


def test_unknown_brand_meta_falls_through():
    assert BRANDS.for_transaction({"brand": "nope"}, "淘宝", "").id == "taobao"


def test_account_brand_from_meta_or_segment():
    assert BRANDS.for_account("Liabilities:Credit:Huabei", {"brand": "alipay"}).id == "alipay"
    assert BRANDS.for_account("Assets:Bank:CMB:1234", {}).id == "cmb"
    assert BRANDS.for_account("Assets:Digital:Alipay", {}).id == "alipay"
    assert BRANDS.for_account("Liabilities:Credit:Huabei", {}) is None


def test_logo_path_and_fit():
    assert BRANDS.by_id["jd"].to_json() == {"id": "jd", "name": "京东", "logo": "/logos/jd.svg", "fit": "tile"}
    assert BRANDS.by_id["boc"].to_json() == {"id": "boc", "name": "中国银行", "logo": "/logos/boc.svg", "fit": "mark"}
    assert BRANDS.by_id["taobao"].to_json()["logo"] is None
