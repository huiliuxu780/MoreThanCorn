# 09-SDD P1-11：可复现发布包——后端 API 镜像
# 09-13 审计修复（P0-3）：构建上下文必须是仓库根——requirements.txt 引用
# ../packages/runtime_contract，旧写法（context=server/）在依赖安装阶段必然失败。
# 构建（在仓库根执行）：docker build -t morethancorn-api:<tag> -f server/Dockerfile .
# 运行：docker run --env-file .env.prod -p 8000:8000 morethancorn-api:<tag>
# 迁移：docker run --env-file .env.prod morethancorn-api:<tag> alembic upgrade head
# 注意：本机暂无 Docker，此文件为静态修复；首次真实构建验证前不得宣称镜像可用。
FROM python:3.12-slim

WORKDIR /app

# 本地包 + 依赖锁定（requirements.txt 为 pip freeze 固定版本；
# pip 从 /app/server 工作目录解析 ../packages/runtime_contract → /app/packages）
COPY packages ./packages
COPY server/requirements.txt ./server/requirements.txt
WORKDIR /app/server
RUN pip install --no-cache-dir -r requirements.txt

# 应用与迁移脚本
COPY server/app ./app
COPY server/alembic ./alembic
COPY server/alembic.ini .

ENV PYTHONUNBUFFERED=1 \
    WF_ENV=production

EXPOSE 8000

# 默认启动 API。进程模型（与 docs/ops/release.md §4 一致）：
# - Worker：生产默认关（WF_EMBEDDED_WORKER=off），无独立入口——需要时同容器
#   WF_EMBEDDED_WORKER=on 随 API lifespan 启动；独立 Worker 容器属部署切片欠账；
# - Watcher：MTC_WATCHER 默认 on，随 API 进程启动（多实例由 watcher 锁互斥）。
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
