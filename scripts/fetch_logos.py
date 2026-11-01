"""按配置目录里的 brands.yaml 抓取品牌图标到同一目录的 logos/。配置目录取 $CONFIG_DIR，默认仓库里的 config/。

vCards 和 Simple Icons 按路径或 slug 直接下载。App Store 图标第一次按搜索词取首个结果，之后按 logos/sources.json 里记下的 app_id 精确查找，
所以抓错时改 sources.json 里的 app_id（或删掉该条换搜索词）再重跑即可。

每张图在 sources.json 里记一个 fit，界面据此决定怎么放进白色圆角底：
  mark  贴边的裸标志（透明或白底、图形顶到边），界面四周留白
  tile  原样铺满：自带底色的 App 图标，或本身已经留了白的图
新抓的图自动判断，已有的 fit 不覆盖；判错时直接改 sources.json，想重判就删掉这个字段再跑 --fit。

用法：uv run python scripts/fetch_logos.py [--force] [--fit] [id ...]
  --fit  不联网，给 logos/ 里还没有 fit 的图补上
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

import yaml
from PIL import Image

ROOT = Path(os.environ.get("CONFIG_DIR") or Path(__file__).resolve().parent.parent / "config")
LOGOS = ROOT / "logos"
SOURCES = LOGOS / "sources.json"
SIMPLE_ICONS = "https://cdn.jsdelivr.net/npm/simple-icons@16.36.0"
VCARDS = "https://raw.githubusercontent.com/metowolf/vCards/master/data"


def _is_bg(c):
    return c[3] < 32 or min(c[:3]) > 235  # 透明或近白


def judge_fit(path):
    """自带底色（离边 2% 的一圈里有一条边过半不是透明或白色）→ tile；
    否则是裸标志，图形离边不到 8% → mark，已经留了白 → tile。"""
    if path.suffix == ".svg":
        return "tile"  # Simple Icons 的图由 simpleicons() 生成，品牌色铺满
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    t = round(w * 0.02)
    edges = [[px[x, y] for x in range(w)] for y in (t, h - 1 - t)]
    edges += [[px[x, y] for y in range(h)] for x in (t, w - 1 - t)]
    if any(sum(not _is_bg(c) for c in e) >= len(e) / 2 for e in edges):
        return "tile"
    pts = [(x, y) for y in range(h) for x in range(w) if not _is_bg(px[x, y])]
    if not pts:
        return "tile"
    xs, ys = [x for x, _ in pts], [y for _, y in pts]
    margin = min(min(xs), min(ys), w - 1 - max(xs), h - 1 - max(ys)) / w
    return "mark" if margin < 0.08 else "tile"


def logo_path(bid):
    return next((p for p in (LOGOS / f"{bid}.{ext}" for ext in ("png", "svg")) if p.exists()), None)


def save(sources):
    SOURCES.write_text(json.dumps(sources, ensure_ascii=False, indent=1, sort_keys=True) + "\n")


def get(url, tries=4):
    # 用 curl：urllib 走代理时常被中途断开。iTunes 限流返回 429/403，等一会儿再试
    for n in range(tries):
        r = subprocess.run(
            ["curl", "-sSL", "-m", "30", "-A", "Mozilla/5.0", "-w", "\n%{http_code}", url],
            capture_output=True,
        )
        body, _, code = r.stdout.rpartition(b"\n")
        if r.returncode == 0 and code == b"200":
            return body
        if n < tries - 1:
            time.sleep(60 if code in (b"429", b"403") else 3)
    raise RuntimeError(f"HTTP {code.decode() or r.stderr.decode().strip()}")


def appstore(brand, known):
    store = brand.get("store", "cn")
    if known.get("app_id"):
        q = {"id": known["app_id"], "country": store}
        url = "https://itunes.apple.com/lookup?" + urllib.parse.urlencode(q)
    else:
        q = {"term": brand["appstore"], "country": store, "entity": "software", "limit": 1}
        url = "https://itunes.apple.com/search?" + urllib.parse.urlencode(q)
    results = json.loads(get(url))["results"]
    if not results:
        return None
    app = results[0]
    art = app["artworkUrl512"].replace("512x512bb.jpg", "512x512bb.png")
    (LOGOS / f"{brand['id']}.png").write_bytes(get(art))
    return {
        "source": "appstore",
        "store": store,
        "app_id": app["trackId"],
        "app_name": app["trackName"],
        "seller": app.get("sellerName", ""),
    }


def vcards(brand):
    path = brand["vcards"]
    (LOGOS / f"{brand['id']}.png").write_bytes(get(f"{VCARDS}/{urllib.parse.quote(path)}.png"))
    return {"source": "vcards", "path": path}


def simpleicons(brand, meta):
    slug = brand["simpleicons"]
    svg = get(f"{SIMPLE_ICONS}/icons/{slug}.svg").decode()
    path = re.search(r' d="([^"]+)"', svg).group(1)
    color = "#" + meta[slug]
    # 和 App 图标一致：品牌色铺满方形，白色图形居中，圆角交给界面裁
    out = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        f'<rect width="24" height="24" fill="{color}"/>'
        f'<path transform="translate(4.8 4.8) scale(.6)" fill="#FFFFFF" d="{path}"/></svg>'
    )
    (LOGOS / f"{brand['id']}.svg").write_text(out)
    return {"source": "simpleicons", "slug": slug, "color": color}


def main():
    args = sys.argv[1:]
    force = "--force" in args
    only = {a for a in args if not a.startswith("--")}
    LOGOS.mkdir(exist_ok=True)
    sources = json.loads(SOURCES.read_text()) if SOURCES.exists() else {}
    brands = [b for group in yaml.safe_load((ROOT / "brands.yaml").read_text()).values() for b in group]

    if "--fit" in args:
        for b in brands:
            bid = b["id"]
            if (not only or bid in only) and bid in sources and "fit" not in sources[bid] and (p := logo_path(bid)):
                sources[bid]["fit"] = judge_fit(p)
                print(f"{bid}: {sources[bid]['fit']}")
        save(sources)
        return
    si_meta = None

    for b in brands:
        bid = b["id"]
        if only and bid not in only:
            continue
        kind = next((k for k in ("vcards", "appstore", "simpleicons") if k in b), None)
        if kind is None:
            continue  # 没写来源：故意不放图
        have = any((LOGOS / f"{bid}.{ext}").exists() for ext in ("png", "svg"))
        # source 为 manual 的是手动放进来的图（比如自己换的原版图标），不覆盖
        if have and not force and sources.get(bid, {}).get("source") in (kind, "manual"):
            continue
        try:
            if kind == "vcards":
                info = vcards(b)
            elif kind == "simpleicons":
                if si_meta is None:
                    data = json.loads(get(f"{SIMPLE_ICONS}/data/simple-icons.json"))
                    si_meta = {i["slug"]: i["hex"] for i in data if "slug" in i}
                    si_meta |= {re.sub(r"[^a-z0-9]", "", i["title"].lower()): i["hex"] for i in data}
                info = simpleicons(b, si_meta)
            else:
                info = appstore(b, sources.get(bid, {}))
                time.sleep(4)  # iTunes Search API 每分钟约 20 次
        except Exception as e:  # noqa: BLE001  单个品牌失败不影响其他
            print(f"✗ {bid}: {e}")
            continue
        if info is None:
            print(f"✗ {bid}: App Store 没搜到「{b['appstore']}」")
            continue
        for ext in {"png", "svg"} - {"svg" if kind == "simpleicons" else "png"}:
            (LOGOS / f"{bid}.{ext}").unlink(missing_ok=True)  # 换了来源时去掉旧格式的图
        # 手改过的 fit 重抓时保留
        info["fit"] = sources.get(bid, {}).get("fit") or judge_fit(logo_path(bid))
        sources[bid] = info
        save(sources)  # 每抓一个就落盘，中途被打断也不丢进度
        name = info.get("app_name") or info.get("path") or info.get("slug")
        print(f"✓ {bid}: {name}  {info.get('seller', '')}  {info['fit']}")


if __name__ == "__main__":
    main()
