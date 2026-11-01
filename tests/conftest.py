from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from beanui.app import create_app

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def client():
    app = create_app(
        FIXTURES / "ledger" / "main.bean",
        config_dir=FIXTURES / "config",
        web_dist=None,
        today=lambda: date(2026, 10, 31),
    )
    return TestClient(app)
