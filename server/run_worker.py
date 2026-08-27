"""09-SDD P1（审计：进程拆分）：独立 Worker 进程入口。

用法：python run_worker.py
生产拓扑下 API / Worker / Scheduler 分离部署；API 进程不再内嵌 worker。
"""
import signal
import time

from app.runner import start_worker_only


def main() -> None:
    stop = start_worker_only()
    print("[worker] worker 已启动（独立进程）")

    def _sig(*_):
        stop.set()

    signal.signal(signal.SIGTERM, _sig)
    signal.signal(signal.SIGINT, _sig)
    try:
        while not stop.is_set():
            time.sleep(1)
    finally:
        print("[worker] worker 已停止")


if __name__ == "__main__":
    main()
