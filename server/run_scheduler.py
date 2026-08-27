"""09-SDD P1（审计：进程拆分）：独立 Scheduler 进程入口。

用法：python run_scheduler.py
生产拓扑下应单实例运行（或配合选主/分布式锁），避免重复触发调度。
"""
import signal
import time

from app.runner import start_scheduler_only


def main() -> None:
    stop = start_scheduler_only()
    print("[scheduler] scheduler 已启动（独立进程，需保证单实例）")

    def _sig(*_):
        stop.set()

    signal.signal(signal.SIGTERM, _sig)
    signal.signal(signal.SIGINT, _sig)
    try:
        while not stop.is_set():
            time.sleep(1)
    finally:
        print("[scheduler] scheduler 已停止")


if __name__ == "__main__":
    main()
