"""PostgreSQL DataReader（09-P0-03 首发真实适配器）。

- validate：真实 `SELECT 1` 最小权限探测；
- read_page：键集游标分页（以 idField 升序），禁止一次加载全量；
- 时间窗：timeField >= now() - N days（由 locator.window_days 驱动）；
- 源不可用：抛 ReaderError，任务链失败关闭。"""
from sqlalchemy.orm import Session

from .base import DataPage, ReaderError, safe_ident


class PostgresReader:
    def __init__(self, db: Session, datasource):
        from ..models import Connection
        self.datasource_id = datasource.id
        self.database = datasource.location or ""
        conn = (db.get(Connection, datasource.connection_id)
                if datasource.connection_id else None)
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
            raise ReaderError(f"无法连接 {self.host}:{self.port}/{self.database}: {exc}") from exc

    def validate(self) -> dict:
        try:
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    cur.fetchone()
            return {"ok": True, "detail": "select 1"}
        except ReaderError as exc:
            return {"ok": False, "detail": str(exc)}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "detail": str(exc)}

    @staticmethod
    def _where_window(locator: dict) -> tuple[str, list]:
        tf = locator.get("timeField")
        days = locator.get("window_days")
        if tf and days:
            return f" WHERE {safe_ident(tf)} >= now() - make_interval(days => %s)", [int(days)]
        return "", []

    def count(self, locator: dict) -> int:
        table = safe_ident(locator.get("table", ""))
        where, params = self._where_window(locator)
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT count(*) FROM {table}{where}", params)
                return int(cur.fetchone()[0])

    def read_page(self, locator: dict, cursor: str | None, limit: int) -> DataPage:
        table = safe_ident(locator.get("table", ""))
        idf = safe_ident(locator.get("idField") or "id")
        where_w, params = self._where_window(locator)
        where_c = f" WHERE {idf} > %s" if cursor else ""
        if where_w and where_c:
            where = where_w + f" AND {idf} > %s"
        else:
            where = where_w or where_c
        sql = (f"SELECT * FROM {table}{where} "
               f"ORDER BY {idf} ASC LIMIT %s")
        # 游标值类型自适应：纯数字按 int 传（int 列），否则按 text
        cursor_val = int(cursor) if (cursor and cursor.isdigit()) else cursor
        rows_out = []
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, [*params, cursor_val, limit] if cursor else [*params, limit])
                cols = [d.name for d in cur.description]
                for raw in cur.fetchall():
                    rows_out.append(dict(zip(cols, raw)))
        next_cursor = str(rows_out[-1][idf]) if len(rows_out) == limit else None
        return DataPage(rows=rows_out, next_cursor=next_cursor)
