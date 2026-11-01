"""收付方 → 品牌。规则见 config/brands.yaml 文件头。"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import yaml

# 比对前去掉的字符：空白、括号和常见分隔符
_IGNORED = re.compile(r"[\s()\[\]{}【】「」『』〔〕<>《》·・\-_]")


def normalize(text: str) -> str:
    """去空格、全角转半角、忽略大小写和括号。"""
    return _IGNORED.sub("", unicodedata.normalize("NFKC", text)).casefold()


@dataclass(frozen=True)
class Brand:
    id: str
    name: str
    logo: str | None  # logos/ 下的文件名，缺图时为 None
    fit: str = "tile"  # mark：贴边的裸标志，界面四周留白；tile：原样铺满。取自 logos/sources.json

    def to_json(self) -> dict:
        return {"id": self.id, "name": self.name, "logo": f"/logos/{self.logo}" if self.logo else None, "fit": self.fit}


class Brands:
    def __init__(self, brands: list[Brand], keys: dict[str, list[str]]):
        self.by_id = {b.id: b for b in brands}
        # (规整后的关键词, 品牌)，按文件顺序；同长时先出现的优先
        self._keys = [(k, self.by_id[bid]) for bid, ks in keys.items() for k in ks]

    @classmethod
    def load(cls, directory: Path) -> Brands:
        data = yaml.safe_load((directory / "brands.yaml").read_text(encoding="utf-8")) or {}
        logos = directory / "logos"
        sources = json.loads(f.read_text(encoding="utf-8")) if (f := logos / "sources.json").is_file() else {}
        brands, keys = [], {}
        for group in data.values():
            for item in group or []:
                bid = str(item["id"])
                logo = next(
                    (f"{bid}{ext}" for ext in (".png", ".svg") if (logos / f"{bid}{ext}").is_file()),
                    None,
                )
                fit = "mark" if sources.get(bid, {}).get("fit") == "mark" else "tile"
                brands.append(Brand(bid, str(item["name"]), logo, fit))
                names = [item["name"], *(item.get("aliases") or [])]
                keys[bid] = [n for n in (normalize(str(x)) for x in names) if n]
        return cls(brands, keys)

    @classmethod
    def empty(cls) -> Brands:
        return cls([], {})

    def match(self, text: str | None) -> Brand | None:
        """取命中最长的关键词对应的品牌。"""
        if not text:
            return None
        n = normalize(text)
        best, best_len = None, 0
        for key, brand in self._keys:
            if len(key) > best_len and key in n:
                best, best_len = brand, len(key)
        return best

    def for_transaction(self, meta: dict, payee: str | None, narration: str | None) -> Brand | None:
        """brand: 元数据 → game: 元数据 → 收付方 → 收付方为空时用摘要。"""
        if (bid := meta.get("brand")) and (b := self.by_id.get(str(bid))):
            return b
        if (game := meta.get("game")) and (b := self.match(str(game))):
            return b
        if payee:
            return self.match(payee)
        return self.match(narration)

    def for_account(self, account: str, meta: dict) -> Brand | None:
        """open 指令上的 brand: 元数据；没有时，科目里有一段恰好是品牌 id（如 Assets:Bank:CMB）也算。"""
        if (bid := meta.get("brand")) and (b := self.by_id.get(str(bid))):
            return b
        for part in reversed(account.split(":")[1:]):
            if b := self.by_id.get(part.lower()):
                return b
        return None
