"""账本约定：账户页的分组、信用卡、代管。默认照常见的科目写法；配置目录里 config.yaml 写了的项覆盖默认，
写法见仓库里的 config/config.yaml。"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml


@dataclass(frozen=True)
class Group:
    name: str
    single: bool = False  # 组里每个账户单列；否则按前三段归并（信用卡按银行、投资按品种、钱包按平台）


# 科目第二段 → 分组。按这个顺序排，表里没有的排在后面；分组账户的 open 上写了 name: 时以它为准。
GROUPS = {
    "Assets": {
        "Bank": Group("银行", True),
        "Cash": Group("现金"),
        "Investments": Group("投资"),
        "Digital": Group("数字钱包"),
        "Receivables": Group("应收"),
        "Prepaid": Group("预付"),
    },
    "Liabilities": {
        "CreditCard": Group("信用卡"),
        "Payables": Group("应付"),
        "Credit": Group("消费信贷"),
        "Installment": Group("分期", True),
    },
}
# 信用卡科目第三段的银行代码 → 显示名；银行账户上写了 bank-name: 时以它为准
BANKS = {
    "ABC": "农业银行",
    "BOC": "中国银行",
    "CCB": "建设银行",
    "CITIC": "中信银行",
    "CMB": "招商银行",
    "ICBC": "工商银行",
    "SPDB": "浦发银行",
}


@dataclass(frozen=True)
class Config:
    groups: dict[str, dict[str, Group]] = field(default_factory=lambda: GROUPS)
    credit_card: str = "Liabilities:CreditCard"  # 这个科目下第三段是银行，按银行合并算额度
    banks: dict[str, str] = field(default_factory=lambda: BANKS)
    custody: str | None = "Custody"  # 第二段是它的科目是替别人管的钱，按第三段分人；None 不单列

    @classmethod
    def load(cls, directory: Path | None) -> Config:
        """读 directory/config.yaml；没有这个文件或文件是空的时全用默认。
        groups 按 Assets、Liabilities 整张替换（顺序就是显示顺序），banks 在默认表上增改。"""
        f = directory / "config.yaml" if directory else None
        data = (yaml.safe_load(f.read_text(encoding="utf-8")) if f and f.is_file() else None) or {}
        unknown = set(data) - {"groups", "credit_card", "banks", "custody"}
        if unknown:
            raise ValueError(f"config.yaml 里有认不出的项：{'、'.join(sorted(unknown))}")
        groups = dict(GROUPS)
        for root, table in (data.get("groups") or {}).items():
            if root not in GROUPS:
                raise ValueError(f"config.yaml 的 groups 只能写 Assets、Liabilities，不能写 {root}")
            groups[root] = {
                str(key): Group(str(g), False) if isinstance(g, str) else Group(str(g["name"]), bool(g.get("single")))
                for key, g in (table or {}).items()
            }
        custody = data.get("custody", "Custody")
        return cls(
            groups=groups,
            credit_card=str(data.get("credit_card") or "Liabilities:CreditCard").rstrip(":"),
            banks={**BANKS, **{str(k): str(v) for k, v in (data.get("banks") or {}).items()}},
            custody=str(custody) if custody else None,
        )

    def is_credit_card(self, account: str) -> bool:
        return account.startswith(self.credit_card + ":")

    def credit_card_bank(self, account: str) -> str:
        """信用卡科目归到哪家银行：取到根下面一段，如 Liabilities:CreditCard:CMB:1234 → Liabilities:CreditCard:CMB。"""
        depth = self.credit_card.count(":") + 2
        return ":".join(account.split(":")[:depth])

    def custody_holder(self, account: str) -> str | None:
        """代管科目属于谁：Assets:Custody:<人>:… → Custody:<人>，不是代管时返回 None。

        代管是替别人管的钱（Assets:Custody:<人> 和 Liabilities:Custody:<人> 成对），不计入资产、负债两边，
        按人单独列；净资产照旧全算，两边不相等时差额留在净资产里。"""
        parts = account.split(":")
        return ":".join(parts[1:3]) if self.custody and parts[1:2] == [self.custody] else None
