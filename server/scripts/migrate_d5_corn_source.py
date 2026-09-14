"""D5 存量源迁移（09-14 拍板连接统一）：CORN 源凭据/表目录归 Connection/DataAsset。

幂等：源已有 connection_id 即跳过。步骤：
1. 解密源 secret_ref（信封加密）→ 建 Connection（protocol=maxcompute，
   endpoint={endpoint, project}，secret_ref 重新信封加密）；
2. Datasource（type=maxcompute，connection_id，location=project）；
3. DataAsset（datasource_id，location=table，config={partitioned, comment}）；
4. 源 connection_id/asset_id 落引用；config/secret_ref 保留为兼容列（双写过渡）。

用法：cd server && .venv/bin/python scripts/migrate_d5_corn_source.py [--dry-run]
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal
from app.models import Connection, DataAsset, DataSource, Datasource
from app.secrets import decrypt_payload, encrypt_secret, serialize_secret

SOURCE_NAME = "CORN 短信模板（QuickBI 数据集底表）"


def main() -> int:
    dry = "--dry-run" in sys.argv
    db = SessionLocal()
    try:
        src = db.query(DataSource).filter_by(name=SOURCE_NAME).first()
        if src is None:
            print("未找到源：", SOURCE_NAME)
            return 1
        if src.connection_id:
            print("已迁移过，跳过：connection_id =", src.connection_id)
            return 0
        cfg = src.config or {}
        endpoint = str(cfg.get("endpoint") or "")
        project = str(cfg.get("project") or "")
        table = str(cfg.get("table") or "")
        secret = decrypt_payload(src.secret_ref) if src.secret_ref else {}
        print(f"源 {src.id} endpoint={endpoint} project={project} table={table}")
        if dry:
            print("[dry-run] 不写库")
            return 0
        conn = Connection(
            name=f"MaxCompute·{project}", kind="aksk", protocol="maxcompute",
            endpoint={"endpoint": endpoint, "project": project},
            secret_ref=encrypt_secret(serialize_secret(secret)),
            lifecycle="active", status="active")
        db.add(conn)
        db.flush()
        ds = Datasource(name=f"MaxCompute·{project}", type="maxcompute",
                        connection_id=conn.id, location=project,
                        status="enabled")
        db.add(ds)
        db.flush()
        asset = DataAsset(name=table, source="catalog", datasource_id=ds.id,
                          location=table, record_meaning="一行 CORN 短信模板",
                          record_id_field="id", time_field="gmt_create",
                          config={"partitioned": True,
                                  "comment": "QuickBI 文件数据集底表（D5 目录发现）"})
        db.add(asset)
        db.flush()
        src.connection_id = conn.id
        src.asset_id = asset.id
        db.commit()
        print(f"迁移完成：connection={conn.id} datasource={ds.id} asset={asset.id}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
