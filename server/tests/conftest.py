"""测试环境确定性：节点并发度固定 1（生产默认并行，见 runner WF_PAR_RUN）。

SDD-12 AR-09 / P0-05：pytest 套件运行在**显式测试 fixture profile**——
WF_TEST_FIXTURES=1 由本文件统一开启；生产（WF_ENV=production）下该开关恒失效。
需要验证"失败关闭（fail closed）"语义的用例须在用例内显式移除该环境变量。
"""
import os

os.environ.setdefault("WF_PAR_RUN", "1")
os.environ.setdefault("WF_TEST_FIXTURES", "1")
