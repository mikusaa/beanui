import subprocess
import sys
from datetime import date
from pathlib import Path

from beancount import loader
from fastapi.testclient import TestClient

from beanui.app import create_app

ROOT = Path(__file__).resolve().parent.parent


def test_demo_ledger_loads_cleanly(tmp_path):
    """示例账本没有语法错误、余额断言都对得上，界面能读。"""
    subprocess.run([sys.executable, ROOT / "scripts" / "demo.py", tmp_path, "--end", "2026-10-31"], check=True, capture_output=True)
    _, errors, _ = loader.load_file(str(tmp_path / "main.bean"))
    assert errors == []
    client = TestClient(create_app(tmp_path / "main.bean", web_dist=None, today=lambda: date(2026, 10, 31)))
    assert client.get("/api/journal").json()["count"] > 50
