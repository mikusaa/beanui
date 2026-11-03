import os
import shutil
import subprocess
import time
from datetime import date, datetime, timezone

from fastapi.testclient import TestClient

from beanui.app import create_app

from .conftest import FIXTURES


def items(body):
    return [t for d in body["days"] for t in d["items"]]


def test_journal_defaults_to_this_month_newest_first(client):
    body = client.get("/api/journal").json()
    assert body["count"] == 9  # 九月那笔不在本月
    assert [d["date"] for d in body["days"]] == ["2026-10-31", "2026-10-30", "2026-10-28", "2026-10-24", "2026-10-20", "2026-10-05"]
    assert body["days"][0]["weekday"] == "周六"
    # 同一天按文件顺序倒过来
    assert [t["payee"] for t in body["days"][0]["items"]] == ["米哈游", "美团外卖"]


def test_journal_totals(client):
    body = client.get("/api/journal").json()
    assert body["expense"] == "97.70"  # 18.20 + 30 + 45 + 4.50
    assert body["income"] == "14200.00"
    day = body["days"][0]
    assert (day["expense"], day["income"], day["transfer"]) == ("48.20", "0.00", "0.00")
    assert body["days"][1]["transfer"] == "2000.00"


def test_kinds_and_signs(client):
    by = {t["narration"]: t for t in items(client.get("/api/journal").json())}
    ram = by["内存条 DDR4"]
    assert (ram["kind"], ram["amount"]) == ("expense", "-45.00")
    assert ram["category"] == {"account": "Expenses:Tech:Homelab", "name": "Homelab", "group": "Tech"}
    assert ram["sources"] == ["花呗"]
    assert ram["tags"] == ["Alipay"]
    salary = by["十月工资"]
    assert (salary["kind"], salary["amount"]) == ("income", "14200.00")
    assert salary["category"]["name"] == "工资"
    assert salary["targets"] == ["招行 1234"]
    # 还款带了优惠，仍算转账
    repay = by["信用卡还款"]
    assert (repay["kind"], repay["amount"], repay["category"]) == ("transfer", "2000.00", None)
    assert (repay["sources"], repay["targets"]) == (["BOC 8765"], ["BOC 5678"])


def test_brands_in_journal(client):
    by = {t["narration"]: t["brand"] and t["brand"]["id"] for t in items(client.get("/api/journal").json())}
    assert by["牛肉饭"] == "meituanwaimai"
    assert by["月卡"] == "genshin"  # 按 game: 元数据
    assert by["京东白条还款"] == "jdfinance"  # 收付方为空，用摘要
    assert by["十月工资"] is None


def test_note_metadata(client):
    by = {t["narration"]: t["note"] for t in items(client.get("/api/journal").json())}
    assert by["牛肉饭"] == "公司楼下店，加一份卤蛋，备注不要香菜"
    assert by["月卡"] == ""
    tid = next(t["id"] for t in items(client.get("/api/journal").json()) if t["narration"] == "牛肉饭")
    assert client.get(f"/api/txn/{tid}").json()["note"].startswith("公司楼下店")


def test_identical_transactions_get_distinct_ids(client):
    ids = [t["id"] for t in items(client.get("/api/journal").json()) if t["payee"] == "腾讯云"]
    assert len(ids) == 2 and len(set(ids)) == 2


def test_time_ranges(client):
    # 含七月账户页用的 7 笔；11-15、12-15 两笔预记的分期在 future 里，不算
    assert client.get("/api/journal", params={"time": "all"}).json()["count"] == 20
    assert client.get("/api/journal", params={"time": "last-month"}).json()["count"] == 1
    assert client.get("/api/journal", params={"time": "2026-09"}).json()["count"] == 1
    assert client.get("/api/journal", params={"time": "2026"}).json()["count"] == 20
    assert client.get("/api/journal", params={"time": "2025"}).json()["count"] == 0
    assert client.get("/api/journal", params={"time": "bogus"}).status_code == 400


def test_search(client):
    def found(q):
        return [t["narration"] for t in items(client.get("/api/journal", params={"q": q, "time": "all"}).json())]

    assert found("淘宝") == ["内存条 DDR4", "散热风扇"][::-1]
    assert found("ddr4") == ["内存条 DDR4"]
    assert found("#alipay") == ["散热风扇", "内存条 DDR4"]
    assert found("Homelab 风扇") == ["散热风扇"]  # 多个词都要命中
    assert found("餐饮") == ["牛肉饭"]  # 科目中文名
    assert found("Expenses:Tech:Device") == ["无线鼠标"]


def test_filters(client):
    def count(**params):
        return client.get("/api/journal", params={"time": "all", **params}).json()["count"]

    assert count(account="Liabilities:Credit") == 4  # 花呗两笔、白条两笔
    assert count(account="Liabilities:Credit:Huabei") == 2
    assert count(account="Expenses:Tech") == 3
    assert count(account=["Liabilities:Credit", "Expenses:Tech"]) == 3  # 两个条件都要满足
    assert count(tag="Alipay") == 2
    assert count(payee="腾讯云") == 2


def test_paging_keeps_day_totals(client):
    first = client.get("/api/journal", params={"limit": 4}).json()
    assert first["next"] == 4
    assert sum(len(d["items"]) for d in first["days"]) == 4
    rest = client.get("/api/journal", params={"offset": 4, "limit": 100}).json()
    assert rest["next"] is None
    assert rest["count"] == 9
    # 跨页的日子，日合计按整天算
    assert first["days"][-1]["date"] == rest["days"][0]["date"] == "2026-10-28"
    assert rest["days"][0]["expense"] == "49.50"


def test_future_is_kept_apart(client):
    """今天以后的交易收进 future：不进 days、count 和合计，自己带笔数、合计和日期范围，组内照样按日分组。"""
    body = client.get("/api/journal", params={"time": "all"}).json()
    assert body["days"][0]["date"] == "2026-10-31"
    assert all(d["date"] <= "2026-10-31" for d in body["days"])
    assert body["expense"] == "7196.70"  # 不含两笔分期的 600（全算是 7796.70）
    future = body["future"]
    assert (future["count"], future["expense"], future["income"]) == (2, "600.00", "0.00")
    assert (future["first"], future["last"]) == ("2026-11-15", "2026-12-15")
    assert [d["date"] for d in future["days"]] == ["2026-12-15", "2026-11-15"]
    assert future["days"][0]["weekday"] == "周二"
    assert future["days"][0]["expense"] == "300.00"
    assert future["transfer"] == "0.00"
    assert [t["narration"] for d in future["days"] for t in d["items"]] == ["宽带分期", "宽带分期"]
    # 本月没有未来的交易
    assert client.get("/api/journal").json()["future"] is None


def test_future_follows_filters(client):
    def journal(**params):
        return client.get("/api/journal", params={"time": "all", **params}).json()

    hits = journal(q="分期")
    assert (hits["count"], hits["days"], hits["future"]["count"]) == (0, [], 2)
    assert journal(q="淘宝")["future"] is None
    assert journal(account="Liabilities:CreditCard:CMB")["future"]["count"] == 2
    assert journal(account="Expenses:Food")["future"] is None
    assert journal(time="2026-12")["future"]["days"][0]["date"] == "2026-12-15"
    assert journal(time="2026-12")["count"] == 0


def test_future_transfer_total(tmp_path):
    """预记的分期还款是转账：组标题没有支出和收入时写转账合计。"""
    shutil.copytree(FIXTURES / "ledger", tmp_path / "ledger")
    (tmp_path / "ledger" / "data" / "2026-extra.bean").write_text(
        '2026-11-20 * "花呗" "分期还款"\n  Assets:Digital:Alipay  -120.00 CNY\n  Liabilities:Credit:Huabei\n',
        encoding="utf-8",
    )
    app = create_app(tmp_path / "ledger" / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 10, 31))
    future = TestClient(app).get("/api/journal", params={"time": "all", "q": "花呗"}).json()["future"]
    assert (future["count"], future["expense"], future["transfer"]) == (1, "0.00", "120.00")


def test_future_is_not_paged(client):
    first = client.get("/api/journal", params={"time": "all", "limit": 4}).json()
    assert first["next"] == 4
    assert [t["date"] for t in items(first)] == ["2026-10-31", "2026-10-31", "2026-10-30", "2026-10-28"]
    assert first["future"]["count"] == 2
    last = client.get("/api/journal", params={"time": "all", "offset": 16, "limit": 4}).json()
    assert last["next"] is None and len(items(last)) == 4
    assert last["future"] == first["future"]


def test_today_is_not_future():
    """今天的交易照常在列表里，明天起才算预记。"""
    app = create_app(FIXTURES / "ledger" / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 10, 30))
    body = TestClient(app).get("/api/journal").json()
    assert body["count"] == 7 and body["days"][0]["date"] == "2026-10-30"
    assert body["future"]["count"] == 2  # 10-31 的两笔；分期在下月，不在本月
    assert body["future"]["last"] == "2026-10-31"
    assert body["expense"] == "49.50"


def test_txn_detail(client):
    ram = next(t for t in items(client.get("/api/journal").json()) if t["narration"] == "内存条 DDR4")
    body = client.get(f"/api/txn/{ram['id']}").json()
    assert body["balanced"] is True
    assert [(p["name"], p["amount"]) for p in body["postings"]] == [
        ("花呗", "-44.02"),
        ("优惠", "-0.98"),
        ("Homelab", "45.00"),
    ]
    assert body["postings"][0]["brand"]["id"] == "alipay"  # 账户上的 brand: 元数据
    assert body["postings"][2]["group"] == "Tech"
    assert body["source"]["file"].endswith("tests/fixtures/ledger/data/2026.bean")
    assert body["source"]["line"] == 33
    assert body["source"]["text"].splitlines()[0] == '2026-10-28 * "淘宝" "内存条 DDR4" #Alipay'
    assert len(body["source"]["text"].splitlines()) == 4
    assert [o["narration"] for o in body["others"]] == ["散热风扇"]


def test_txn_others_past_before_future(tmp_path):
    """同收付方的其他交易：已经发生的在前（新到旧），未来的在后（近到远）；超过 5 条时先截未来的。"""
    shutil.copytree(FIXTURES / "ledger", tmp_path / "ledger")
    bill = '{} * "{}" "{}"\n  Liabilities:CreditCard:CMB:0001  -{} CNY\n  Expenses:Housing:Internet\n'
    dates = ["2026-12-01", "2026-06-01", "2027-01-01", "2026-09-01", "2026-11-01", "2026-07-01", "2026-10-01", "2026-08-01"]
    power = ["2027-02-10", "2026-09-10", "2026-12-10", "2026-11-10"]
    (tmp_path / "ledger" / "data" / "2026-extra.bean").write_text(
        "".join(bill.format(d, "长城宽带", "月费", "50.00") for d in dates)
        + "".join(bill.format(d, "国家电网", "电费", "80.00") for d in power),
        encoding="utf-8",
    )
    app = create_app(tmp_path / "ledger" / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 10, 31))
    c = TestClient(app)

    def others(payee, day):
        body = c.get("/api/journal", params={"time": "all", "q": payee}).json()
        txns = items(body) + [t for d in body["future"]["days"] for t in d["items"]]
        tid = next(t["id"] for t in txns if t["date"] == day)
        return [o["date"] for o in c.get(f"/api/txn/{tid}").json()["others"]]

    assert others("长城宽带", "2026-10-01") == ["2026-09-01", "2026-08-01", "2026-07-01", "2026-06-01", "2026-11-01"]
    # 已经发生的就够 5 条，未来的都截掉
    assert others("长城宽带", "2027-01-01") == ["2026-10-01", "2026-09-01", "2026-08-01", "2026-07-01", "2026-06-01"]
    assert others("国家电网", "2026-09-10") == ["2026-11-10", "2026-12-10", "2027-02-10"]


def test_txn_detail_fills_interpolated_amount(client):
    salary = next(t for t in items(client.get("/api/journal").json()) if t["narration"] == "十月工资")
    body = client.get(f"/api/txn/{salary['id']}").json()
    assert [p["amount"] for p in body["postings"]] == ["14200.00", "-14200.00"]


def test_txn_not_found(client):
    assert client.get("/api/txn/nope").status_code == 404


def test_facets(client):
    body = client.get("/api/facets").json()
    assert body["years"] == [2026]
    assert {"account": "Liabilities:Credit:Huabei", "name": "花呗", "count": 2} in body["accounts"]
    assert all(a["account"].split(":")[0] in ("Expenses", "Income") for a in body["categories"])
    assert body["tags"] == [{"tag": "Alipay", "count": 2}]
    assert {"payee": "腾讯云", "count": 2} in body["payees"]
    # 没记过账的父科目也有名字，从账户页点进流水时筛选标签用它
    posted = {a["account"] for a in body["accounts"]}
    assert "Assets:Custody:Xiaoming" not in posted and body["names"]["Assets:Custody:Xiaoming"] == "小明代管资金"
    assert "Liabilities:CreditCard:CMB" not in posted and body["names"]["Liabilities:CreditCard:CMB"] == "CMB"
    assert body["names"]["Liabilities:Credit:Huabei"] == "花呗"


def test_logos_are_served(client):
    r = client.get("/logos/jd.svg")
    assert r.status_code == 200 and r.text.startswith("<svg")


def test_reloads_when_ledger_changes(tmp_path):
    shutil.copytree(FIXTURES / "ledger", tmp_path / "ledger")
    app = create_app(tmp_path / "ledger" / "main.bean", config_dir=FIXTURES / "config", web_dist=None,
                     today=lambda: date(2026, 10, 31))
    c = TestClient(app)
    assert c.get("/api/journal").json()["count"] == 9
    time.sleep(0.01)
    # 新增一个文件，入口文件本身不变
    (tmp_path / "ledger" / "data" / "2026-extra.bean").write_text(
        '2026-10-31 * "美团" "午饭"\n  Assets:Digital:Alipay  -20.00 CNY\n  Expenses:Food:Meals\n',
        encoding="utf-8",
    )
    body = c.get("/api/journal").json()
    assert body["count"] == 10
    lunch = next(t for t in items(body) if t["narration"] == "午饭")
    assert lunch["brand"]["id"] == "meituan"


def test_reloads_when_file_changes_during_load(tmp_path, monkeypatch):
    """git pull 正好在加载时写文件：这次读到的是旧内容，下一次请求要再加载，不能把新的修改时间记下就算了。"""
    shutil.copytree(FIXTURES / "ledger", tmp_path / "ledger")
    app = create_app(tmp_path / "ledger" / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 10, 31))
    c = TestClient(app)
    assert c.get("/api/journal").json()["count"] == 9

    from beanui import ledger as ledger_module

    real_load = ledger_module.loader.load_file
    target = tmp_path / "ledger" / "data" / "2026.bean"

    def load_then_write(path):
        result = real_load(path)
        if target.read_text(encoding="utf-8").count("午饭") == 0:
            time.sleep(0.01)
            with open(target, "a", encoding="utf-8") as f:
                f.write('\n2026-10-31 * "美团" "午饭"\n  Assets:Digital:Alipay  -20.00 CNY\n  Expenses:Food:Meals\n')
        return result

    monkeypatch.setattr(ledger_module.loader, "load_file", load_then_write)
    time.sleep(0.01)
    target.touch()
    assert c.get("/api/journal").json()["count"] == 9  # 这次加载读到的还是旧的
    assert c.get("/api/journal").json()["count"] == 10


def test_funds_carry_account_and_brand(client):
    by = {t["narration"]: t for t in items(client.get("/api/journal").json())}
    repay = by["信用卡还款"]
    assert repay["funds"] == {
        "sources": [{"account": "Assets:Bank:BOC:8765", "name": "BOC 8765", "brand": repay["funds"]["sources"][0]["brand"]}],
        "targets": [{"account": "Liabilities:CreditCard:BOC:5678", "name": "BOC 5678", "brand": repay["funds"]["targets"][0]["brand"]}],
    }
    assert repay["funds"]["sources"][0]["brand"]["id"] == "boc"
    # 名字和 sources / targets 一致
    for t in by.values():
        assert [f["name"] for f in t["funds"]["sources"]] == t["sources"]
        assert [f["name"] for f in t["funds"]["targets"]] == t["targets"]
    ram = by["内存条 DDR4"]["funds"]["sources"][0]
    assert (ram["name"], ram["brand"]["id"]) == ("花呗", "alipay")


def test_status_names_the_ledger_file(client):
    body = client.get("/api/status").json()
    assert body["file"] == "tests/fixtures/ledger/main.bean"
    assert (body["title"], body["currency"], body["errors"]) == ("示例账本", "CNY", 0)


def git(cwd, *args):
    env = {"GIT_AUTHOR_DATE": "2026-10-28T21:14:00+08:00", "GIT_COMMITTER_DATE": "2026-10-28T21:14:00+08:00"}
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "init.defaultBranch=main", *args],
        cwd=cwd, check=True, capture_output=True, env={**os.environ, **env},
    )


def test_txn_detail_commit_from_git(tmp_path):
    """详情（手机详情页和电脑端详情栏）里的「提交」：这一行最后一次提交的短哈希和时间，没提交的行为空。"""
    shutil.copytree(FIXTURES / "ledger", tmp_path / "ledger")
    git(tmp_path, "init", "-q")
    git(tmp_path, "add", ".")
    git(tmp_path, "commit", "-q", "-m", "init")
    with open(tmp_path / "ledger" / "data" / "2026.bean", "a", encoding="utf-8") as f:
        f.write('\n2026-10-31 * "美团" "晚饭"\n  Assets:Digital:Alipay  -30.00 CNY\n  Expenses:Food:Meals\n')
    app = create_app(tmp_path / "ledger" / "main.bean", config_dir=FIXTURES / "config", web_dist=None,
                     today=lambda: date(2026, 10, 31))
    c = TestClient(app)
    by = {t["narration"]: t for t in items(c.get("/api/journal").json())}

    ram = c.get(f"/api/txn/{by['内存条 DDR4']['id']}").json()
    head = subprocess.run(["git", "rev-parse", "--short=7", "HEAD"], cwd=tmp_path, capture_output=True, text=True).stdout.strip()
    assert ram["commit"] == {"hash": head, "time": int(datetime(2026, 10, 28, 13, 14, tzinfo=timezone.utc).timestamp())}
    assert ram["source"]["file"] == "ledger/data/2026.bean"

    assert c.get(f"/api/txn/{by['晚饭']['id']}").json()["commit"] is None


def test_pages_open_directly(tmp_path):
    """电脑端直接打开 /txn/<id>（后面可以跟着流水的筛选）也是交给前端，显示成流水加右侧详情。"""
    (tmp_path / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    app = create_app(FIXTURES / "ledger" / "main.bean", config_dir=FIXTURES / "config", web_dist=tmp_path,
                     today=lambda: date(2026, 10, 31))
    c = TestClient(app)
    for path in ("/journal?time=all&q=%E6%B7%98%E5%AE%9D", "/txn/abc123?time=last-month", "/txn/abc123-2"):
        r = c.get(path)
        assert r.status_code == 200 and "id=root" in r.text
    assert c.get("/api/txn/abc123").status_code == 404


def test_cache_headers(tmp_path):
    """带哈希的构建产物长期缓存；sw.js、index.html、manifest、logo 和数据每次都找服务器确认。"""
    (tmp_path / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    (tmp_path / "sw.js").write_text("self.skipWaiting()", encoding="utf-8")
    (tmp_path / "manifest.webmanifest").write_text("{}", encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "index-abc123.js").write_text("console.log(1)", encoding="utf-8")
    app = create_app(FIXTURES / "ledger" / "main.bean", config_dir=FIXTURES / "config", web_dist=tmp_path,
                     today=lambda: date(2026, 10, 31))
    c = TestClient(app)
    for path in ("/", "/accounts", "/index.html", "/sw.js", "/manifest.webmanifest", "/logos/jd.svg", "/api/status"):
        r = c.get(path)
        assert r.status_code == 200 and r.headers["cache-control"] == "no-cache", path
    r = c.get("/assets/index-abc123.js")
    assert r.status_code == 200 and r.headers["cache-control"] == "public, max-age=31536000, immutable"
    # 已经不存在的旧构建产物不能拿 index.html 顶替
    assert c.get("/assets/index-old.js").status_code == 404


def sync_app(tmp_path, sync_dir):
    """带 .git/sync-status 的账本副本；sync_dir 为 None 时是本机开发的样子。"""
    shutil.copytree(FIXTURES / "ledger", tmp_path / "ledger")
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "sync-status").write_text("ok 2026-10-31T08:00:00Z abc1234\n", encoding="utf-8")
    app = create_app(tmp_path / "ledger" / "main.bean", config_dir=None, web_dist=None,
                     today=lambda: date(2026, 10, 31), sync_dir=sync_dir)
    return TestClient(app)


def test_sync_without_sync_dir_is_404(tmp_path):
    client = sync_app(tmp_path, None)
    assert client.post("/api/sync").status_code == 404
    sync = client.get("/api/status").json()["sync"]
    assert (sync["commit"], sync["can_sync"], sync["pending"]) == ("abc1234", False, False)


def test_sync_writes_request(tmp_path):
    sync_dir = tmp_path / "sync"
    sync_dir.mkdir()
    client = sync_app(tmp_path, sync_dir)
    sync = client.get("/api/status").json()["sync"]
    assert (sync["can_sync"], sync["pending"]) == (True, False)

    before = datetime.now(timezone.utc).replace(microsecond=0)
    r = client.post("/api/sync")
    assert r.status_code == 202
    requested = r.json()["requested"]
    assert (sync_dir / "request").read_text(encoding="utf-8").strip() == requested
    assert datetime.fromisoformat(requested) >= before
    assert [p.name for p in sync_dir.iterdir()] == ["request"]  # 临时文件改名过去了，没留下
    assert client.get("/api/status").json()["sync"]["pending"] is True
    assert client.get("/api/overview").json()["sync"]["pending"] is True

    # 还没被取走时再点不重写，返回原来的请求时间
    time.sleep(1.1)
    assert client.post("/api/sync").json()["requested"] == requested

    # git-sync 取走请求
    (sync_dir / "request").unlink()
    assert client.get("/api/status").json()["sync"]["pending"] is False


def test_sync_request_fails_without_volume(tmp_path):
    client = sync_app(tmp_path, tmp_path / "missing")
    r = client.post("/api/sync")
    assert r.status_code == 500
    assert "写不了同步请求" in r.json()["detail"]


# ── 流水里的其他指令 ──────────────────────────────────────


def test_journal_shows_only_transactions_by_default(client):
    body = client.get("/api/journal").json()
    assert {t["type"] for t in items(body)} == {"txn"}
    # 各类型的条数照样给，开关上显示；预记的价格不算
    assert body["types"] == {"txn": 9, "balance": 2, "open": 0, "note": 1, "price": 1, "document": 1}


def test_journal_types(client):
    body = client.get("/api/journal", params=[("type", "txn"), ("type", "balance"), ("type", "note")]).json()
    kinds = [(t["date"], t["type"]) for t in items(body)]
    assert ("2026-10-20", "note") in kinds
    # 同一天的余额断言排在交易下面（它断言的是当天开始时的余额）
    oct31 = [k for d, k in kinds if d == "2026-10-31"]
    assert oct31[-1] == "balance" and set(oct31[:-1]) == {"txn"}
    # 笔数和合计只算交易
    assert (body["count"], body["expense"]) == (9, client.get("/api/journal").json()["expense"])
    assert client.get("/api/journal", params={"type": "bogus"}).status_code == 400


def test_directive_rows(client):
    def only(kind, **params):
        return items(client.get("/api/journal", params={"time": "all", "type": kind, **params}).json())

    bal = only("balance")[0]
    assert {k: bal[k] for k in ("account", "name", "amount", "currency", "ok", "diff")} == {
        "account": "Assets:Bank:CMB:1234",
        "name": "招行 1234",
        "amount": "8101.00",
        "currency": "CNY",
        "ok": True,
        "diff": None,
    }
    assert only("note")[0]["comment"] == "花呗额度调到 5000"
    assert only("document")[0]["filename"] == "receipt.txt"
    price = only("price")[0]
    assert (price["name"], price["currency"], price["amount"], price["quote"]) == ("积存金", "GOLD", "530.00", "CNY")
    opened = only("open", time="2020")
    assert len(opened) == 28 and opened[0]["action"] == "open"


def test_directives_follow_filters(client):
    def count(kind, **params):
        return client.get("/api/journal", params={"time": "all", **params}).json()["types"][kind]

    assert count("balance", account="Assets:Bank:CMB") == 1
    assert count("note", account="Assets:Digital:Alipay") == 1
    assert count("price", account="Assets:Bank") == 0  # 价格没有科目
    assert count("balance", payee="淘宝") == 0
    assert count("note", q="额度") == 1
    assert count("price", q="积存金") == 3
    assert count("open", q="招行 1234") == 1


def test_future_directives(client):
    future = client.get("/api/journal", params=[("time", "all"), ("type", "txn"), ("type", "price")]).json()["future"]
    assert future["count"] == 3  # 两笔预记交易和一条预记的价格
    assert future["last"] == "2026-12-15"


def test_directive_detail(client):
    bal = items(client.get("/api/journal", params={"type": "balance"}).json())[0]
    detail = client.get(f"/api/txn/{bal['id']}").json()
    assert detail["type"] == "balance"
    assert detail["source"]["file"].endswith("data/directives.bean")
    assert detail["source"]["text"].startswith("2026-10-31 balance Assets:Bank:CMB:1234")


def test_failing_balance_and_close(tmp_path):
    shutil.copytree(FIXTURES / "ledger", tmp_path / "ledger")
    (tmp_path / "ledger" / "data" / "2026-extra.bean").write_text(
        "2026-10-02 balance Assets:Digital:Alipay  90.00 CNY\n2026-10-25 close Liabilities:Credit:Baitiao\n",
        encoding="utf-8",
    )
    app = create_app(tmp_path / "ledger" / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 10, 31))
    client = TestClient(app)
    body = client.get("/api/journal", params=[("type", "balance"), ("type", "open")]).json()
    by = {(t["type"], t["date"]): t for t in items(body)}
    bad = by[("balance", "2026-10-02")]
    assert (bad["ok"], bad["amount"], bad["actual"], bad["diff"]) == (False, "90.00", "100.00", "10.00")
    assert by[("open", "2026-10-25")]["action"] == "close"
    assert client.get("/api/status").json()["errors"] == 1


def test_same_day_sorted_by_time(tmp_path):
    # 话费在另一个文件靠后的行，写了 time: "00:00"；beancount 按行号会把它排在早饭后面
    (tmp_path / "main.bean").write_text(
        'option "operating_currency" "CNY"\n'
        'include "a.bean"\ninclude "b.bean"\ninclude "c.bean"\n'
    )
    txn = '2026-10-31 * "{}"{}\n  Expenses:Food  1 CNY\n  Assets:Cash\n\n'
    (tmp_path / "a.bean").write_text(
        "2026-01-01 open Assets:Cash\n2026-01-01 open Expenses:Food\n\n"
        + txn.format("早饭", "")  # 没写时间，跟后一笔
        + txn.format("午饭", '\n  time: "12:00"')
        + txn.format("零食", "")  # 跟前一笔
        + "2026-10-31 balance Assets:Cash  0 CNY\n"
    )
    (tmp_path / "b.bean").write_text("\n" * 40 + txn.format("话费", '\n  time: "00:00"'))
    (tmp_path / "c.bean").write_text(txn.format("杂项", ""))  # 整个文件当天都没时间，排在最后
    app = create_app(tmp_path / "main.bean", config_dir=None, web_dist=None, today=lambda: date(2026, 10, 31))
    body = TestClient(app).get("/api/journal", params={"type": ["txn", "balance"]}).json()
    day = body["days"][0]["items"]
    assert [t.get("narration") or t["type"] for t in day] == ["杂项", "零食", "午饭", "早饭", "话费", "balance"]
