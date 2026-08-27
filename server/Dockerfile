# 09-SDD P1-11：可复现发布包——后端 API 镜像
# 构建：docker build -t morethancorn-api:<tag> -f server/Dockerfile server
# 运行：docker run --env-file .env.prod -p 8000:8000 morethancorn-api:<tag>
# 迁移：docker run --env-file .env.prod morethancorn-api:<tag> alembic upgrade head
FROM python:3.12-slim

WORKDIR /app

# 依赖锁定（requirements.txt 为 pip freeze 的固定版本，保证可复现）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 应用与迁移脚本
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini .

ENV PYTHONUNBUFFERED=1 \
    WF_ENV=production

EXPOSE 8000

# 默认启动 API；Worker/Scheduler 建议独立容器（同镜像，见 docs/ops/release.md）
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
