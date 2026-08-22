import os

import sys as _sys

DATABASE_URL = os.environ.get(
    "WF_DATABASE_URL",
    "postgresql+psycopg://rivers@127.0.0.1:5432/wf_test" if "pytest" in _sys.modules
    else "postgresql+psycopg://rivers@127.0.0.1:5432/wf_dev",
)
