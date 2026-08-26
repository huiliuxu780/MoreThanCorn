"""内联资产读取器：DataAsset.rows（原型首发数据形态）。"""
from sqlalchemy.orm import Session

from .base import DataPage, ReaderError


class InlineAssetReader:
    def __init__(self, db: Session, asset):
        self.db = db
        self.asset_id = asset.id

    def _rows(self) -> list:
        from ..models import DataAsset
        a = self.db.get(DataAsset, self.asset_id)
        if not a:
            raise ReaderError(f"数据资产 {self.asset_id} 不存在")
        return [r for r in (a.rows or []) if isinstance(r, dict)]

    def validate(self) -> dict:
        from ..models import DataAsset
        if not self.db.get(DataAsset, self.asset_id):
            return {"ok": False, "detail": "数据资产不存在"}
        return {"ok": True, "detail": "inline"}

    def count(self, locator: dict) -> int:
        return len(self._rows())

    def read_page(self, locator: dict, cursor: str | None, limit: int) -> DataPage:
        rows = self._rows()
        offset = int(cursor) if cursor else 0
        chunk = rows[offset:offset + limit]
        next_cursor = str(offset + limit) if offset + limit < len(rows) else None
        return DataPage(rows=chunk, next_cursor=next_cursor, total_hint=len(rows))
