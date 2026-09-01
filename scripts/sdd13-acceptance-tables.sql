-- SDD 13 §16：验收目标表参考 DDL（两张预创建真实 PostgreSQL 目标表）。
-- 谱系列、_run_id 唯一约束与 JSONB 业务结果列不得删除；
-- 平台不自动建表/ALTER，本文件由验收者显式执行（psql -f）。

CREATE TABLE IF NOT EXISTS public.consumer_analysis_result_acceptance (
    _run_id text PRIMARY KEY,
    _task_run_id text NOT NULL,
    _task_id text NOT NULL,
    _task_version_id text NOT NULL,
    _interaction_ref text NOT NULL,
    _output_schema_ref text NOT NULL,
    _written_at timestamptz NOT NULL,
    call_id text NOT NULL,
    analysis_status text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    segments jsonb NOT NULL,
    full_output jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_consumer_acceptance_task_run
    ON public.consumer_analysis_result_acceptance (_task_run_id);

CREATE INDEX IF NOT EXISTS ix_consumer_acceptance_interaction
    ON public.consumer_analysis_result_acceptance (_interaction_ref);

CREATE TABLE IF NOT EXISTS public.quality_rules_result_acceptance (
    _run_id text PRIMARY KEY,
    _task_run_id text NOT NULL,
    _task_id text NOT NULL,
    _task_version_id text NOT NULL,
    _interaction_ref text NOT NULL,
    _output_schema_ref text NOT NULL,
    _written_at timestamptz NOT NULL,
    call_id text NOT NULL,
    rule_set_id text NOT NULL,
    rule_set_version integer NOT NULL,
    results jsonb NOT NULL,
    result_by_rule jsonb NOT NULL,
    summary text NOT NULL,
    full_output jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_quality_acceptance_task_run
    ON public.quality_rules_result_acceptance (_task_run_id);

CREATE INDEX IF NOT EXISTS ix_quality_acceptance_interaction
    ON public.quality_rules_result_acceptance (_interaction_ref);
