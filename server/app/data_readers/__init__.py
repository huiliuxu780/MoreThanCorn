"""DataReader 适配器（09-SDD §6.2 / P0-03）。

每类 DataSource 独立 Adapter；连接测试执行真实最小操作；读取分页/游标；
外部源不可用必须失败（M-11：禁止生成替代 rows）。"""
from .base import DataPage, ReaderError
from .inline import InlineAssetReader
from .postgres import PostgresReader

__all__ = ["DataPage", "ReaderError", "InlineAssetReader", "PostgresReader", "get_reader"]


def get_reader(db, asset):
    """按资产来源选择 Adapter：绑定 Datasource → 按类型；否则内联 rows。

    未实现的类型一律失败关闭（不得 mock 通过）。"""
    if asset.datasource_id:
        from ..models import Datasource
        ds = db.get(Datasource, asset.datasource_id)
        if not ds:
            raise ReaderError(f"datasource {asset.datasource_id} 不存在")
        if ds.type == "postgresql":
            return PostgresReader(db, ds)
        raise ReaderError(f"数据源类型 {ds.type} 的 DataReader 未实现（生产禁止 mock 替代）")
    return InlineAssetReader(db, asset)
