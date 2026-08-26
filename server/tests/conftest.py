"""测试环境确定性：节点并发度固定 1（生产默认并行，见 runner WF_PAR_RUN）。"""
import os

os.environ.setdefault("WF_PAR_RUN", "1")
