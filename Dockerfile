# syntax=docker/dockerfile:1
# 后端连同构建好的前端，只读挂载账本仓库；amd64 和 arm64 两份。用法见 README 的「部署」。

# ── 前端 ──
# 产物是静态文件、和架构无关，固定在构建机的架构上跑，省得 QEMU 模拟 npm
FROM --platform=$BUILDPLATFORM node:26.13.0-trixie-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
RUN npm run build

# ── Python 依赖 ──
FROM python:3.14.10-slim-trixie AS deps
COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
# 只装依赖不装项目本身：beanui/ 直接放在 /app 下，app.py 按自己的位置找 config/ 和 web/dist/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project --extra plugins

# ── git ──
# 界面只用 git blame、rev-parse 这些内置命令，都在 /usr/bin/git 一个文件里，要的库（pcre2、zlib）基础镜像本来就有。
# 整包装 git 会带上 perl 和 curl，镜像大 100MB
FROM python:3.14.10-slim-trixie AS git
RUN apt-get update && apt-get install -y --no-install-recommends git

# ── 运行 ──
FROM python:3.14.10-slim-trixie
COPY --from=git /usr/bin/git /usr/bin/git
# git 给交易详情的提交记录用。账本目录的属主和容器用户对不上，不加 safe.directory 会报 dubious ownership。
# /sync 放同步请求：compose 的具名卷第一次挂上时照这里的权限建，否则卷归 root，两边用 user: 换了 uid 都写不了；
# git-sync 要能删界面写的请求，所以不加粘滞位
RUN git config --system safe.directory '*' \
    && useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin beanui \
    && mkdir -m 777 /sync
WORKDIR /app
COPY --from=deps /app/.venv .venv
COPY beanui/ beanui/
# 示例配置和品牌表，不带图标；用自己的配置时挂一个目录、设 CONFIG_DIR
COPY config/ config/
COPY --from=web /src/web/dist web/dist
# 文件都归 root、所有人可读；compose 用 user: 换成别的 uid 也能跑，运行时什么都不写
RUN python -m compileall -q beanui
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp \
    HOST=0.0.0.0 \
    PORT=8100
USER beanui
EXPOSE 8100
CMD ["python", "-m", "beanui.app"]
