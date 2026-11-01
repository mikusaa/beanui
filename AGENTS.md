# beanui

只读的 Beancount 网页界面。功能、配置、部署见 [README.md](README.md)，接口见 [docs/api.md](docs/api.md)。
术语见 [GLOSSARY.md](GLOSSARY.md)，定下的取舍见 [docs/adr/](docs/adr/)，改口径前先看。

## 规矩

- **界面不写账本。** 后端只读 `$LEDGER` 和它 include 的文件；同步只在 `$SYNC_DIR` 里写请求。
- **测试和示例只用虚构数据**：`tests/fixtures/` 下的账本和品牌表、`config/` 下的示例配置、`scripts/demo.py` 生成的示例账本。
  真实账本、个人配置、品牌图标都不入库（`local/` 已忽略）。
- 账本约定（分组、信用卡、代管）都从 `config.yaml` 读，不在代码里写死某一本账的科目；
  新加约定时在 `beanui/config.py` 给默认值，在 `config/config.yaml` 写上注释掉的示例。
- 文档、注释、提交信息用中文，写法跟周围一致。

## 改完怎么验证

1. `uv run pytest`；`cd web && npm run typecheck && npm run build`。
2. 用一本账本跑起来看（没有就用 `scripts/demo.py` 生成示例账本）：手机宽度（390px）和电脑宽度（≥ 1024px）都看一遍，深色模式也看。
3. 改了后端要重启服务；前端 build 完刷新页面即可。
4. 接口有变化时同步改 `docs/api.md`。
5. 做完 [docs/roadmap.md](docs/roadmap.md) 里的功能，把它从「打算做」挪到对应位置。

## 发版

在 `main` 上提交。版本号写在 `pyproject.toml`、`web/package.json`（和两个锁文件里的项目版本），
打 `v<版本号>` 标签推送后 CI 出镜像（标签规则见 `.github/workflows/image.yml`）。
