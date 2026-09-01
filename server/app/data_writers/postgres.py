"""PostgreSQL DataWriter（SDD 13 §7.2 首发唯一 sink）。

- 全参数化 SQL；表名/列名只来自已验证元数据并经 safe_ident 引号化；
- append = ON CONFLICT (key) DO NOTHING；upsert = DO UPDATE；两者都依赖目标唯一键幂等；
- 不写测试行再删除来探测权限（§6.3），用 has_table_privilege；
- 错误按 SQLSTATE 分类（base.classify_sqlstate）。"""
from __future__ import annotations

from ..data_readers.base import safe_ident
from .base import TargetColumn, TargetMetadata, TargetReference, WriterError, classify_sqlstate


class PostgresWriter:
    def __init__(self, db, datasource):
        from ..models import Connection
        self.datasource_id = datasource.id if datasource else None
        self.database = (datasource.location or "") if datasource else ""
        conn = (db.get(Connection, datasource.connection_id)
                if datasource and datasource.connection_id else None)
        ep = (conn.endpoint if conn else {}) or {}
        self.host = ep.get("host", "127.0.0.1")
        self.port = int(ep.get("port", 5432))
        self.user = ep.get("user", "postgres")
        self._secret_ref = conn.secret_ref if conn else ""

    def _connect(self):
        import psycopg
        password = ""
        if self._secret_ref:
            from ..runner import _decrypt
            password = _decrypt(self._secret_ref)
        try:
            return psycopg.connect(host=self.host, port=self.port, dbname=self.database,
                                   user=self.user, password=password, connect_timeout=3)
        except Exception as exc:  # noqa: BLE001
            code, retryable = classify_sqlstate(getattr(exc, "sqlstate", None))
            if getattr(exc, "sqlstate", None) is None:
                code, retryable = "TARGET_CONNECTION_ERROR", True
            raise WriterError(code, f"无法连接 {self.host}:{self.port}/{self.database}: {exc}",
                              retryable=retryable) from exc

    @staticmethod
    def _qualified(binding: dict) -> str:
        schema = safe_ident(binding.get("schemaName") or "public")
        table = safe_ident(binding.get("table") or "")
        return f"{schema}.{table}"

    def inspect_target(self, binding: dict) -> TargetMetadata:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT column_name, data_type, is_nullable, column_default "
                    "FROM information_schema.columns "
                    "WHERE table_schema = %s AND table_name = %s",
                    [binding.get("schemaName") or "public", binding.get("table") or ""])
                cols = {r[0]: TargetColumn(name=r[0], pg_type=r[1],
                                           nullable=r[2] == "YES", has_default=r[3] is not None)
                        for r in cur.fetchall()}
                if not cols:
                    raise WriterError("TARGET_TABLE_MISSING",
                                      f"目标表 {self._qualified(binding)} 不存在", retryable=False)
                cur.execute(
                    "SELECT (SELECT array_agg(a.attname ORDER BY x.ord) "
                    "         FROM unnest(c.conkey) WITH ORDINALITY AS x(attnum, ord) "
                    "         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum) AS cols, "
                    "       c.contype "
                    "FROM pg_constraint c "
                    "JOIN pg_class t ON t.oid = c.conrelid "
                    "JOIN pg_namespace n ON n.oid = t.relnamespace "
                    "WHERE n.nspname = %s AND t.relname = %s AND c.contype IN ('p', 'u')",
                    [binding.get("schemaName") or "public", binding.get("table") or ""])
                uniques = [tuple(r[0]) for r in cur.fetchall() if r[0]]
        return TargetMetadata(schema_name=binding.get("schemaName") or "public",
                              table=binding.get("table") or "", columns=cols,
                              unique_constraints=uniques)

    def check_write_privilege(self, binding: dict) -> None:
        """§6.3：只读权限探测，禁止写一行再删除。"""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT has_table_privilege(current_user, %s, 'INSERT')",
                            [self._qualified(binding)])
                if not cur.fetchone()[0]:
                    raise WriterError("TARGET_PERMISSION_DENIED",
                                      f"目标账号对 {self._qualified(binding)} 无 INSERT 权限",
                                      retryable=False)

    def write_record(self, binding: dict, record: dict, *, idempotency_key: str) -> TargetReference:
        import psycopg
        key_fields = list(binding.get("keyFields") or [])
        if not key_fields:
            raise WriterError("BINDING_KEY_INVALID", "缺少唯一键 keyFields，无法幂等写入",
                              retryable=False)
        cols = [safe_ident(c) for c in record.keys()]
        for k in key_fields:
            safe_ident(k)  # 键名白名单校验
        placeholders = ", ".join(["%s"] * len(record))
        conflict = ", ".join(safe_ident(k) for k in key_fields)
        if (binding.get("writeMode") or "upsert") == "append":
            on_conflict = f"ON CONFLICT ({conflict}) DO NOTHING"
        else:
            updates = ", ".join(f"{c} = EXCLUDED.{c}"
                                for c in cols if c not in {safe_ident(k) for k in key_fields})
            on_conflict = (f"ON CONFLICT ({conflict}) DO UPDATE SET {updates}"
                           if updates else f"ON CONFLICT ({conflict}) DO NOTHING")
        sql = (f"INSERT INTO {self._qualified(binding)} ({', '.join(cols)}) "
               f"VALUES ({placeholders}) {on_conflict}")
        values = [psycopg.types.json.Jsonb(v) if isinstance(v, (dict, list)) else v
                  for v in record.values()]
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(sql, values)
                conn.commit()
        except WriterError:
            raise
        except Exception as exc:  # noqa: BLE001
            code, retryable = classify_sqlstate(getattr(exc, "sqlstate", None))
            raise WriterError(code, f"写入目标表失败：{exc}", retryable=retryable) from exc
        return TargetReference(asset_id=binding.get("assetId") or "",
                               schema_name=binding.get("schemaName") or "public",
                               table=binding.get("table") or "",
                               key={k: record.get(k) for k in key_fields})
