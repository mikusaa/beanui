"""生成一本虚构的示例账本，用来试用界面和给 README 截图。人和数都是编的，随机种子固定，每次生成的一样。

账本覆盖截止日之前的 12 个整月（截止月只到截止日），另外预记两笔截止日以后的交易。
有工资和奖金、房租水电、三餐和网购、两家银行的信用卡、花呗、基金定投和积存金、借给朋友的钱、替小明代管的钱，
还有每月初的余额断言、一条备注和一份账单文档。

用法：uv run python scripts/demo.py <目录> [--end YYYY-MM-DD]
  然后 LEDGER=<目录>/main.bean uv run python -m beanui.app
  --end  截止日，默认今天。截在月初时「本月」几乎是空的，截图时取月底更好看
"""

import argparse
import random
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

CNY = "CNY"
SEED = 2026

ACCOUNTS = """\
2020-01-01 open Assets:Bank:CMB:6214
  name: "招行储蓄卡"
2020-01-01 open Assets:Bank:ICBC:3302
  name: "工行储蓄卡"
2020-01-01 open Assets:Cash
  name: "现金"
2020-01-01 open Assets:Digital:Alipay
  name: "支付宝"
2020-01-01 open Assets:Digital:WeChat
  name: "微信零钱"
  brand: "wechat"
2020-01-01 open Assets:Investments:Fund
  name: "基金"
2020-01-01 open Assets:Investments:Gold
  name: "黄金"
2020-01-01 open Assets:Investments:Fund:HS300 HS300
  name: "沪深 300"
2020-01-01 open Assets:Investments:Gold:ICBC GOLD
  name: "工行积存金"
2020-01-01 open Assets:Receivables:Friends
  name: "朋友"
2020-01-01 open Assets:Custody:Xiaoming
  name: "小明代管资金"
2020-01-01 open Assets:Custody:Xiaoming:Alipay
  name: "余额宝"
2020-01-01 open Liabilities:Custody:Xiaoming
  name: "小明代管款"

2020-01-01 open Liabilities:CreditCard:CMB
  credit-limit: 30000
2020-01-01 open Liabilities:CreditCard:CMB:1024
  name: "招行 1024"
2020-01-01 open Liabilities:CreditCard:BOC
  credit-limit: 20000
  card-count: 2
2020-01-01 open Liabilities:CreditCard:BOC:5566
  name: "中行 5566"
2020-01-01 open Liabilities:CreditCard:BOC:7788
  name: "中行 7788"
2020-01-01 open Liabilities:Credit:Huabei
  name: "花呗"
  brand: "alipay"

2020-01-01 open Income:Salary
  name: "工资"
2020-01-01 open Income:Bonus
  name: "奖金"
2020-01-01 open Income:Interest
  name: "利息"
2020-01-01 open Income:Discount
  name: "优惠"

2020-01-01 open Expenses:Food
  name: "餐饮"
2020-01-01 open Expenses:Housing
  name: "居住"
2020-01-01 open Expenses:Transport
  name: "交通"
2020-01-01 open Expenses:Shopping
  name: "购物"
2020-01-01 open Expenses:Tech
  name: "数码"
2020-01-01 open Expenses:Communication
  name: "通讯"
2020-01-01 open Expenses:Entertainment
  name: "娱乐"
2020-01-01 open Expenses:Health
  name: "健康"
2020-01-01 open Expenses:Social
  name: "人情往来"
2020-01-01 open Expenses:Travel
  name: "旅行"

2020-01-01 open Expenses:Food:Meals
  name: "三餐"
2020-01-01 open Expenses:Food:Coffee
  name: "咖啡饮料"
2020-01-01 open Expenses:Food:Groceries
  name: "买菜"
2020-01-01 open Expenses:Housing:Rent
  name: "房租"
2020-01-01 open Expenses:Housing:Utilities
  name: "水电燃气"
2020-01-01 open Expenses:Housing:Internet
  name: "宽带"
2020-01-01 open Expenses:Transport:Public
  name: "公共交通"
2020-01-01 open Expenses:Transport:Taxi
  name: "打车"
2020-01-01 open Expenses:Transport:Train
  name: "火车"
2020-01-01 open Expenses:Shopping:Daily
  name: "日用"
2020-01-01 open Expenses:Shopping:Clothing
  name: "服饰"
2020-01-01 open Expenses:Tech:Device
  name: "设备"
2020-01-01 open Expenses:Tech:Subscriptions
  name: "订阅"
2020-01-01 open Expenses:Communication:Phone
  name: "话费"
2020-01-01 open Expenses:Entertainment:Gaming
  name: "游戏"
2020-01-01 open Expenses:Entertainment:Movies
  name: "电影"
2020-01-01 open Expenses:Health:Medical
  name: "医疗"
2020-01-01 open Expenses:Social:Gifts
  name: "人情"
2020-01-01 open Expenses:Travel:Hotel
  name: "住宿"

2020-01-01 open Equity:Opening-Balances

2020-01-01 commodity HS300
  name: "沪深 300 指数基金"
2020-01-01 commodity GOLD
  name: "积存金（克）"
"""

# 三餐：(收付方, 摘要, 金额范围, 付款方式)
MEALS = [
    ("公司食堂", "午饭", (14, 22), ["Assets:Digital:WeChat"]),
    ("美团外卖", "外卖", (22, 45), ["Liabilities:Credit:Huabei", "Assets:Digital:Alipay"]),
    ("楼下面馆", "牛肉面", (18, 26), ["Assets:Digital:WeChat", "Assets:Cash"]),
    ("便利店", "早饭", (8, 15), ["Assets:Digital:Alipay", "Assets:Digital:WeChat"]),
    ("麦当劳", "汉堡套餐", (30, 45), ["Liabilities:CreditCard:CMB:1024"]),
    ("饺子馆", "晚饭", (25, 40), ["Assets:Digital:WeChat"]),
]
COFFEE = [("瑞幸咖啡", "拿铁", (9, 16)), ("星巴克", "美式", (28, 36)), ("奶茶店", "奶茶", (12, 20))]
SHOPPING = [
    ("京东", "洗衣液", "Expenses:Shopping:Daily", (30, 80)),
    ("京东", "机械键盘", "Expenses:Tech:Device", (300, 500)),
    ("京东", "充电器", "Expenses:Tech:Device", (80, 150)),
    ("淘宝", "卫衣", "Expenses:Shopping:Clothing", (120, 260)),
    ("淘宝", "收纳盒", "Expenses:Shopping:Daily", (25, 60)),
    ("淘宝", "跑鞋", "Expenses:Shopping:Clothing", (300, 600)),
    ("拼多多", "纸巾", "Expenses:Shopping:Daily", (20, 40)),
    ("拼多多", "水果", "Expenses:Food:Groceries", (30, 70)),
]
CARDS = ["Liabilities:CreditCard:CMB:1024", "Liabilities:CreditCard:BOC:5566", "Liabilities:CreditCard:BOC:7788"]


class Book:
    def __init__(self, rng: random.Random):
        self.rng = rng
        self.entries: list[tuple] = []  # (日期, 时间, 文本)
        self.balance: dict[str, Decimal] = defaultdict(Decimal)

    def money(self, lo: float, hi: float) -> Decimal:
        return Decimal(str(round(self.rng.uniform(lo, hi), 2))).quantize(Decimal("0.01"))

    def clock(self, lo: int, hi: int) -> str:
        m = self.rng.randrange(lo * 60, hi * 60)
        return f"{m // 60:02d}:{m % 60:02d}"

    def txn(self, d: date, payee: str, narration: str, postings: list, time: str | None = None, tags=()):
        """postings：(科目, 金额[, 单位, 成本])，最后一条可以只写科目，金额由前面配平。
        带成本的交易把配平的一条也写出金额（取到分），不然 beancount 按未取整的成本算，余额断言对不上。"""
        head = f'{d} * "{payee}" "{narration}"' + "".join(f" #{t}" for t in tags)
        lines = [head]
        if time:
            lines.append(f'  time: "{time}"')
        rest = Decimal(0)
        held = any(len(p) == 4 for p in postings)
        for p in postings:
            account = p[0]
            if len(p) == 1:
                amount = -rest
                lines.append(f"  {account:<50}{amount:>12.2f} {CNY}" if held else f"  {account}")
            elif len(p) == 2:
                amount = p[1]
                lines.append(f"  {account:<50}{amount:>12.2f} {CNY}")
            else:
                units, unit, cost = p[1], p[2], p[3]
                amount = (units * cost).quantize(Decimal("0.01"))
                lines.append(f"  {account:<50}{units:>12} {unit} {{{cost} {CNY}}}")
            if len(p) <= 2:
                self.balance[account] += amount
            rest += amount
        self.entries.append((d, time or "", "\n".join(lines)))

    def raw(self, d: date, text: str, order: str = ""):
        self.entries.append((d, order, text))


def month_starts(end: date) -> list[date]:
    y, m = end.year, end.month - 11
    while m < 1:
        y, m = y - 1, m + 12
    out = []
    for _ in range(12):
        out.append(date(y, m, 1))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def generate(end: date) -> tuple[str, date]:
    rng = random.Random(SEED)
    book = Book(rng)
    months = month_starts(end)
    first = months[0]
    days = [first + timedelta(i) for i in range((end - first).days + 1)]

    book.txn(first - timedelta(1), "", "期初余额", [
        ("Assets:Bank:CMB:6214", Decimal("32000.00")),
        ("Assets:Bank:ICBC:3302", Decimal("8000.00")),
        ("Assets:Cash", Decimal("600.00")),
        ("Assets:Digital:Alipay", Decimal("1500.00")),
        ("Assets:Digital:WeChat", Decimal("800.00")),
        ("Equity:Opening-Balances",),
    ])

    # 价格：基金和积存金每月一个随机游走的收盘价
    fund, gold = Decimal("4.20"), Decimal("560.00")
    prices = {}
    for start in months:
        fund = (fund * Decimal(str(rng.uniform(0.95, 1.07)))).quantize(Decimal("0.0001"))
        gold = (gold * Decimal(str(rng.uniform(0.98, 1.05)))).quantize(Decimal("0.01"))
        prices[start] = (fund, gold)
        book.raw(start, f"{start} price HS300 {fund:>12} {CNY}\n{start} price GOLD {gold:>13} {CNY}", "~")

    for d in days:
        start = d.replace(day=1)
        fund, gold = prices[start]
        wd = d.weekday()

        # 每月初的余额断言，按当天开始前的余额
        if d.day == 1 and d > first:
            book.raw(d, f"{d} balance Assets:Bank:CMB:6214 {book.balance['Assets:Bank:CMB:6214']:>14.2f} {CNY}")

        # 钱包见底时从银行卡转入
        if book.balance["Assets:Digital:Alipay"] < 300:
            book.txn(d, "支付宝", "转入", [("Assets:Digital:Alipay", Decimal("2000.00")), ("Assets:Bank:CMB:6214",)], "08:30")
        if book.balance["Assets:Digital:WeChat"] < 200:
            book.txn(d, "微信", "零钱充值", [("Assets:Digital:WeChat", Decimal("1000.00")), ("Assets:Bank:ICBC:3302",)], "08:35")
        if book.balance["Assets:Cash"] < 100:
            book.txn(d, "工商银行", "取现", [("Assets:Cash", Decimal("500.00")), ("Assets:Bank:ICBC:3302",)], "08:40")

        # 固定的
        if d.day == 1:
            book.txn(d, "房东", "房租", [("Expenses:Housing:Rent", Decimal("3800.00")), ("Assets:Bank:CMB:6214",)], "09:00")
        if d.day == 5:
            book.txn(d, "中国移动", "话费", [("Expenses:Communication:Phone", Decimal("58.00")), ("Assets:Digital:Alipay",)], "10:00")
        if d.day == 8:
            owed = -book.balance["Liabilities:CreditCard:CMB:1024"]
            if owed > 0:
                book.txn(d, "招商银行", "信用卡还款", [("Liabilities:CreditCard:CMB:1024", owed), ("Assets:Bank:CMB:6214",)], "09:10")
        if d.day == 10:
            owed = -book.balance["Liabilities:Credit:Huabei"]
            if owed > 0:
                book.txn(d, "支付宝", "花呗还款", [("Liabilities:Credit:Huabei", owed), ("Assets:Bank:CMB:6214",)], "09:20")
            units = (Decimal("2000") / fund).quantize(Decimal("0.01"))
            book.txn(d, "", "基金定投", [("Assets:Investments:Fund:HS300", units, "HS300", fund), ("Assets:Bank:CMB:6214",)], "09:30")
        if d.day == 12:
            elec = book.money(180, 320) if d.month in (1, 2, 7, 8) else book.money(70, 160)
            book.txn(d, "国家电网", "电费", [("Expenses:Housing:Utilities", elec), ("Assets:Digital:Alipay",)], "20:00")
            book.txn(d, "燃气公司", "燃气费", [("Expenses:Housing:Utilities", book.money(35, 90)), ("Assets:Digital:WeChat",)], "20:02")
        if d.day == 15:
            for card in CARDS[1:]:
                owed = -book.balance[card]
                if owed > 0:
                    book.txn(d, "中国银行", "信用卡还款", [(card, owed), ("Assets:Bank:ICBC:3302",)], "09:00")
        if d.day == 18:
            book.txn(d, "Apple", "iCloud+ 200GB", [("Expenses:Tech:Subscriptions", Decimal("21.00")), ("Liabilities:CreditCard:CMB:1024",)], "03:00")
        if d.day == 25:
            book.txn(d, "示例科技", "工资", [("Assets:Bank:CMB:6214", Decimal("16800.00")), ("Income:Salary",)], "10:00")
        if d.day == 26:
            book.txn(d, "", "转到工行", [("Assets:Bank:ICBC:3302", Decimal("3000.00")), ("Assets:Bank:CMB:6214",)], "12:00")
        if d.day == 21 and d.month in (3, 6, 9, 12):
            book.txn(d, "工商银行", "结息", [("Assets:Bank:ICBC:3302", book.money(5, 15)), ("Income:Interest",)])

        # 三餐和咖啡：工作日早午饭，晚饭和周末随机
        if wd < 5:
            if rng.random() < 0.6:
                payee, what, (lo, hi), pay = MEALS[3]
                book.txn(d, payee, what, [("Expenses:Food:Meals", book.money(lo, hi)), (rng.choice(pay),)], book.clock(7, 9))
            payee, what, (lo, hi), pay = MEALS[0] if rng.random() < 0.6 else rng.choice(MEALS[1:3])
            book.txn(d, payee, what, [("Expenses:Food:Meals", book.money(lo, hi)), (rng.choice(pay),)], book.clock(11, 13))
            if rng.random() < 0.35:
                payee, what, (lo, hi) = rng.choice(COFFEE)
                book.txn(d, payee, what, [("Expenses:Food:Coffee", book.money(lo, hi)), ("Assets:Digital:Alipay",)], book.clock(14, 16))
        if rng.random() < 0.7:
            payee, what, (lo, hi), pay = rng.choice(MEALS[1:])
            book.txn(d, payee, what, [("Expenses:Food:Meals", book.money(lo, hi)), (rng.choice(pay),)], book.clock(18, 21))

        # 周末买菜、看电影，平时偶尔打车
        if wd == 5:
            book.txn(d, rng.choice(["盒马", "菜市场"]), "买菜", [("Expenses:Food:Groceries", book.money(60, 180)), (rng.choice(["Assets:Digital:Alipay", CARDS[0]]),)], book.clock(10, 12))
        if wd == 6 and rng.random() < 0.25:
            book.txn(d, "电影院", "电影票", [("Expenses:Entertainment:Movies", book.money(40, 90)), (rng.choice(CARDS),)], book.clock(14, 19))
        if wd < 5 and rng.random() < 0.12:
            book.txn(d, "滴滴出行", "打车", [("Expenses:Transport:Taxi", book.money(18, 65)), ("Liabilities:CreditCard:BOC:5566",)], book.clock(21, 23))
        if d.day in (3, 17):
            book.txn(d, "地铁", "交通卡充值", [("Expenses:Transport:Public", Decimal("100.00")), ("Assets:Digital:Alipay",)], "08:40")

        # 网购：淘宝有时带优惠
        if rng.random() < 0.13:
            payee, what, category, (lo, hi) = rng.choice(SHOPPING)
            price = book.money(lo, hi)
            if payee == "淘宝" and rng.random() < 0.5:
                off = book.money(1, 8)
                book.txn(d, payee, what, [(category, price), ("Income:Discount", -off), ("Liabilities:Credit:Huabei",)], book.clock(20, 23))
            else:
                pay = "Liabilities:CreditCard:CMB:1024" if payee == "京东" else rng.choice(CARDS[1:])
                book.txn(d, payee, what, [(category, price), (pay,)], book.clock(20, 23))
        if rng.random() < 0.02:
            book.txn(d, "药店", "感冒药", [("Expenses:Health:Medical", book.money(25, 80)), ("Assets:Digital:WeChat",)], book.clock(19, 21))

        # 一次性的
        if (d.month, d.day) == (2, 6):
            book.txn(d, "示例科技", "年终奖", [("Assets:Bank:CMB:6214", Decimal("12000.00")), ("Income:Bonus",)], "15:00")
        if (d.month, d.day) == (2, 16):
            book.txn(d, "", "春节红包", [("Expenses:Social:Gifts", Decimal("2400.00")), ("Assets:Digital:WeChat", Decimal("-400.00")), ("Assets:Bank:CMB:6214",)], "11:00")
        if (d.month, d.day) == (1, 20):
            book.txn(d, "工商银行", "买积存金", [("Assets:Investments:Gold:ICBC", Decimal(10), "GOLD", gold), ("Assets:Bank:ICBC:3302",)], "10:30")
        if (d.month, d.day) == (3, 14):
            book.txn(d, "京东", "笔记本电脑", [("Expenses:Tech:Device", Decimal("6999.00")), ("Income:Discount", Decimal("-300.00")), ("Liabilities:CreditCard:CMB:1024",)], "21:12")
        if (d.month, d.day) == (4, 3):
            book.txn(d, "Steam", "游戏", [("Expenses:Entertainment:Gaming", Decimal("98.00")), ("Assets:Digital:Alipay",)], "22:40")
        if (d.month, d.day) == (5, 1):
            trip = ["hangzhou-trip"]
            book.txn(d, "铁路12306", "去杭州", [("Expenses:Transport:Train", Decimal("73.00")), ("Assets:Digital:Alipay",)], "07:50", trip)
            book.txn(d, "西湖边酒店", "两晚", [("Expenses:Travel:Hotel", Decimal("860.00")), ("Liabilities:CreditCard:CMB:1024",)], "15:00", trip)
            book.txn(d, "知味观", "小笼包", [("Expenses:Food:Meals", Decimal("68.00")), ("Assets:Digital:WeChat",)], "18:30", trip)
        if (d.month, d.day) == (5, 3):
            trip = ["hangzhou-trip"]
            book.txn(d, "茶馆", "龙井", [("Expenses:Social:Gifts", Decimal("268.00")), ("Assets:Digital:WeChat",)], "10:00", trip)
            book.txn(d, "铁路12306", "回程", [("Expenses:Transport:Train", Decimal("73.00")), ("Assets:Digital:Alipay",)], "17:20", trip)
        if (d.month, d.day) == (6, 2):
            book.txn(d, "小明", "转来理财", [("Assets:Bank:ICBC:3302", Decimal("5000.00")), ("Liabilities:Custody:Xiaoming",)], "19:00")
            book.txn(d, "", "替小明买余额宝", [("Assets:Custody:Xiaoming:Alipay", Decimal("5000.00")), ("Assets:Bank:ICBC:3302",)], "19:05")
        if (d.month, d.day) == (8, 12):
            book.txn(d, "阿杰", "借给朋友", [("Assets:Receivables:Friends", Decimal("1000.00")), ("Assets:Bank:ICBC:3302",)], "13:00")
        if (d.month, d.day) == (9, 20):
            book.txn(d, "阿杰", "还了一部分", [("Assets:Bank:ICBC:3302", Decimal("600.00")), ("Assets:Receivables:Friends",)], "13:00")
        if (d.month, d.day) == (10, 20):
            book.txn(d, "京东", "显示器", [("Expenses:Tech:Device", Decimal("1899.00")), ("Liabilities:CreditCard:CMB:1024",)], "22:05")
        if (d.month, d.day) == (9, 28):
            book.txn(d, "中国电信", "宽带年费", [("Expenses:Housing:Internet", Decimal("960.00")), ("Liabilities:CreditCard:BOC:7788",)], "16:00")

    # 上个月的账单文档和一条备注
    bill = months[-2] + timedelta(7)
    book.raw(bill, f'{bill} document Liabilities:CreditCard:CMB "docs/招行账单-{bill:%Y-%m}.txt"', "~")
    book.raw(months[8], f'{months[8]} note Liabilities:CreditCard:CMB "账单日改到每月 7 号"', "~")

    # 截止日以后预记的交易
    nxt = (end.replace(day=28) + timedelta(4)).replace(day=1)
    book.txn(nxt, "房东", "房租", [("Expenses:Housing:Rent", Decimal("3800.00")), ("Assets:Bank:CMB:6214",)], "09:00")
    book.txn(nxt + timedelta(17), "Apple", "iCloud+ 200GB", [("Expenses:Tech:Subscriptions", Decimal("21.00")), ("Liabilities:CreditCard:CMB:1024",)], "03:00")

    book.entries.sort(key=lambda e: (e[0], e[1]))
    body = "; 示例账本：人和数都是编的，由 scripts/demo.py 生成\n\n" + "\n\n".join(t for _, _, t in book.entries) + "\n"
    return body, bill


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("dir", type=Path)
    parser.add_argument("--end", type=date.fromisoformat, default=date.today())
    args = parser.parse_args()

    body, bill = generate(args.end)
    out: Path = args.dir
    (out / "docs").mkdir(parents=True, exist_ok=True)
    (out / "main.bean").write_text(
        'option "title" "示例账本"\noption "operating_currency" "CNY"\n\ninclude "accounts.bean"\ninclude "transactions.bean"\n'
    )
    (out / "accounts.bean").write_text(ACCOUNTS)
    (out / "transactions.bean").write_text(body)
    (out / "docs" / f"招行账单-{bill:%Y-%m}.txt").write_text(f"招商银行信用卡账单（示例）\n账单日 {bill}\n")
    print(f"已生成 {out / 'main.bean'}")


if __name__ == "__main__":
    main()
