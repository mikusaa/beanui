"""在配置目录（$CONFIG_DIR，默认仓库里的 config/）生成 logos/preview.html：逐个列出品牌图标、它来自哪个 App 和 fit，用来核对有没有抓错、判错。

图标照界面的样子画：白底圆角，fit 为 mark 的四周留 13%。
"""

import html
import json
import os
from pathlib import Path

import yaml

ROOT = Path(os.environ.get("CONFIG_DIR") or Path(__file__).resolve().parent.parent / "config")
LOGOS = ROOT / "logos"

groups = yaml.safe_load((ROOT / "brands.yaml").read_text())
sources = json.loads((LOGOS / "sources.json").read_text())

cards = []
for group, brands in groups.items():
    cards.append(f'<h2>{group}</h2><div class="grid">')
    for b in brands:
        src = sources.get(b["id"], {})
        img = next((f"{b['id']}.{e}" for e in ("png", "svg") if (LOGOS / f"{b['id']}.{e}").exists()), None)
        fit = src.get("fit", "tile")
        icon = f'<img src="{img}" alt="">' if img else '<span class="miss">缺</span>'
        via = src.get("app_name") or (f"Simple Icons · {src['slug']}" if "slug" in src else src.get("path", "未抓到"))
        seller = src.get("seller", "")
        cards.append(
            f'<div class="card"><div class="icon {fit if img else ""}">{icon}</div><div><b>{html.escape(b["name"])}</b>'
            f'<small>{html.escape(b["id"])} · {fit if img else "—"}</small><span>{html.escape(via)}</span>'
            f'<span>{html.escape(seller)}</span></div></div>'
        )
    cards.append("</div>")

(LOGOS / "preview.html").write_text(
    """<!doctype html><meta charset="utf-8"><title>品牌图标核对</title><style>
body{margin:0;padding:20px;background:#F5F6F8;color:#101828;font:13px Inter,'Noto Sans SC',system-ui,sans-serif}
h2{font-size:14px;margin:20px 0 8px;color:#475467}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}
.card{display:flex;gap:10px;align-items:center;background:#fff;border:1px solid #E4E7EC;border-radius:12px;padding:8px}
.icon{flex:none;width:48px;height:48px;border-radius:12px;overflow:hidden;background:#F2F4F7;display:flex;align-items:center;justify-content:center}
.icon.mark,.icon.tile{background:#fff;outline:1px solid #E4E7EC;outline-offset:-1px}
.icon img{width:100%;height:100%;object-fit:contain;box-sizing:border-box}.icon.mark img{padding:13%}.miss{color:#D92D20;font-weight:700}
.card div:last-child{display:flex;flex-direction:column;gap:1px;min-width:0}
small,span{color:#5F6B7A;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style>"""
    + "".join(cards)
)
print(LOGOS / "preview.html")
