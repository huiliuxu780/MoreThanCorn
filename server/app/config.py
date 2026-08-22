import os

DATABASE_URL = os.environ.get(
    "WF_DATABASE_URL",
    "postgresql+psycopg://rivers@127.0.0.1:5432/wf_dev",
)
