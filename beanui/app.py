"""HTTP 接口。账本路径取 $LEDGER；配置目录取 $CONFIG_DIR（默认仓库里的 config/），里面是账本约定 config.yaml、
品牌表 brands.yaml 和图标 logos/，都可以没有。同步请求写到 $SYNC_DIR（和 git-sync 共用的卷；不设就没有手动同步）。"""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .accounts import accounts_json
from .brands import Brands
from .config import Config
from .income import income_json
from .ledger import ENTRY_TYPES, Directive, Ledger, _relative
from .overview import overview_json, read_sync_status, request_sync

ROOT = Path(__file__).resolve().parent.parent


def create_app(
    ledger_path: str | os.PathLike,
    config_dir: str | os.PathLike | None = ROOT / "config",
    web_dist: str | os.PathLike | None = ROOT / "web" / "dist",
    today=date.today,
    sync_dir: str | os.PathLike | None = None,
) -> FastAPI:
    sync_path = Path(sync_dir) if sync_dir else None
    config_path = Path(config_dir) if config_dir else None
    brands = Brands.load(config_path) if config_path and (config_path / "brands.yaml").is_file() else Brands.empty()
    ledger = Ledger(ledger_path, brands, today=today, config=Config.load(config_path))

    app = FastAPI(title="Beancount UI", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.ledger = ledger

    # 除了带哈希的构建产物，一律每次找服务器确认：sw.js、index.html、logo 换了浏览器马上能拿到，数据也不走 HTTP 缓存
    @app.middleware("http")
    async def cache_control(request, call_next):
        response = await call_next(request)
        response.headers.setdefault("Cache-Control", "no-cache")
        return response

    @app.get("/api/journal")
    def journal(
        time: str = "month",
        q: str = "",
        account: list[str] = Query([]),
        tag: str = "",
        payee: str = "",
        type: list[str] = Query(["txn"]),
        offset: int = Query(0, ge=0),
        limit: int = Query(200, ge=1, le=1000),
    ):
        """type 可以给多个：txn（交易）、balance、open（含销户）、note、price、document。"""
        ledger.refresh()
        if bad := set(type) - set(ENTRY_TYPES):
            raise HTTPException(400, f"无法识别的类型：{'、'.join(sorted(bad))}")
        try:
            rows = ledger.filter(time=time, q=q, accounts=account, tag=tag, payee=payee)
        except ValueError as err:
            raise HTTPException(400, str(err)) from err
        return ledger.journal_json(rows, types=type, offset=offset, limit=limit, accounts=account)

    @app.get("/api/txn/{tid}")
    def txn(tid: str):
        ledger.refresh()
        t = ledger.by_id.get(tid)
        if not t:
            raise HTTPException(404, "找不到这笔交易，账本可能已经改过")
        # 流水里的其他指令也用这个地址看详情
        return ledger.directive_detail_json(t) if isinstance(t, Directive) else ledger.detail_json(t)

    @app.get("/api/facets")
    def facets():
        ledger.refresh()
        return ledger.facets_json()

    @app.get("/api/overview")
    def overview(time: str = "month", recent: int = Query(5, ge=1, le=50)):
        ledger.refresh()
        try:
            return overview_json(ledger, time, recent, sync_path)
        except ValueError as err:
            raise HTTPException(400, str(err)) from err

    @app.get("/api/income")
    def income(time: str = "year"):
        ledger.refresh()
        try:
            return income_json(ledger, time)
        except ValueError as err:
            raise HTTPException(400, str(err)) from err

    @app.get("/api/accounts")
    def accounts():
        ledger.refresh()
        return accounts_json(ledger)

    @app.get("/api/status")
    def status():
        ledger.refresh()
        return {
            "title": ledger.options.get("title"),
            "file": _relative(str(ledger.path), ledger.root),
            "currency": ledger.currency,
            "transactions": len(ledger.txns),
            "errors": len(ledger.errors),
            "sync": read_sync_status(ledger.root, sync_path),
        }

    @app.post("/api/sync", status_code=202)
    def sync():
        """请 git-sync 马上拉取。界面不碰 git，只在共用的卷里留个请求；拉完 sync-status 的时间会晚于 requested。"""
        if not sync_path:
            raise HTTPException(404, "没有设置 SYNC_DIR，不能手动同步")
        try:
            requested = request_sync(sync_path)
        except OSError as err:
            raise HTTPException(500, f"写不了同步请求：{err}") from err
        return {"requested": requested}

    if config_path and (config_path / "logos").is_dir():
        app.mount("/logos", StaticFiles(directory=config_path / "logos"), name="logos")

    # 前端构建产物；找不到文件的路径都交给 index.html，由前端路由处理
    dist = Path(web_dist) if web_dist else None
    if dist and (dist / "index.html").is_file():

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            f = (dist / path).resolve()
            if path and f.is_file() and f.is_relative_to(dist.resolve()):
                if path.startswith("assets/"):
                    # 文件名带内容哈希，内容变了名字就变
                    return FileResponse(f, headers={"Cache-Control": "public, max-age=31536000, immutable"})
                return FileResponse(f)
            if path.startswith("assets/"):
                # 旧页面要的旧文件已经删了：给 404，别拿 index.html 冒充脚本
                raise HTTPException(404)
            return FileResponse(dist / "index.html")

    return app


def main() -> None:
    import uvicorn

    ledger = os.environ.get("LEDGER")
    if not ledger:
        raise SystemExit("请用环境变量 LEDGER 指向账本入口文件，例如 books/main.bean")
    app = create_app(ledger, os.environ.get("CONFIG_DIR", ROOT / "config"), sync_dir=os.environ.get("SYNC_DIR"))
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "8100")))


if __name__ == "__main__":
    main()
