/**
 * DSH/Cordis-native staged controller for business-analysis@1.0.0（R8-UI-5）。
 *
 * 与 native_quality_workflow.mjs 同契约（name/inject/apply）：阶段状态机 +
 * 提交工具 + 每阶段工具白名单 + 完成屏障。business 为 read-only：
 * 仅 metric_query / dimension_query 两个逻辑工具（经 Tool Gateway MCP）。
 * synthesize 输出严格对齐冻结 business_analysis_output Schema
 * （question_id/answer/metrics/citations，additionalProperties=false）。
 */

export const name = 'native-business-analysis'
export const inject = ['agents', 'tools', 'systemPrompt']

const SUBMIT_TOOL = 'business_analysis_submit'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function assertArray(value, name, min = 1) {
  if (!Array.isArray(value) || value.length < min) {
    throw new Error(`${name} must contain at least ${min} item(s)`)
  }
}

function workflowPrompt() {
  return [
    'You are running under the code-governed business analysis workflow business_analysis_v1.',
    `The only stage transition is a successful ${SUBMIT_TOOL} call.`,
    'The current stage and current task are authoritative in the latest business_analysis_submit result; the initial stage is identify.',
    'Business analysis is READ-ONLY: only metric_query and dimension_query are ever allowed.',
    'At identify: extract the question_id and every metric/dimension that must be queried to answer it. Do not merge independent metrics.',
    `Then call ${SUBMIT_TOOL} with stage="identify" and payload {question_id, plans:[{kind:"metric"|"dimension", subject, query}]}.`,
    'At execute/<plan>: call exactly its tool once with the plan query, then submit {value, unit, citations, reason}.',
    'At synthesize: all plans passed the code barrier. Do not call any tool. Return one JSON object conforming to the business_analysis_output schema: question_id, answer, metrics[{metric,value,unit}], citations[{source,reference,summary?}], optional confidence. No Markdown fence.',
  ].join('\n')
}

function allowedEnterpriseTool(state, name) {
  if (!state.stage.startsWith('execute/')) return false
  const current = state.queue[state.cursor]
  return !!current && name === current.tool
}

function normalizeIdentification(payload, tools) {
  if (!payload?.question_id || typeof payload.question_id !== 'string') {
    throw new Error('question_id is required')
  }
  assertArray(payload?.plans, 'plans', 1)
  const queue = payload.plans.map((item, index) => {
    if (item.kind !== 'metric' && item.kind !== 'dimension') {
      throw new Error(`unsupported plan kind: ${item.kind}`)
    }
    return {
      id: `${item.kind}-${index + 1}`,
      kind: item.kind,
      subject: String(item.subject ?? ''),
      query: String(item.query ?? ''),
      tool: item.kind === 'metric' ? tools.metric : tools.dimension,
    }
  })
  return { questionId: payload.question_id, queue }
}

function validateExecution(state, payload) {
  const current = state.queue[state.cursor]
  const calls = state.stageToolCalls
  if (calls.length !== 1 || calls[0] !== current.tool) {
    throw new Error(`${current.id} must call exactly ${current.tool} once`)
  }
  if (current.kind === 'metric' && typeof payload?.value !== 'number') {
    throw new Error('metric plan requires numeric value')
  }
  return {
    plan_id: current.id,
    kind: current.kind,
    subject: current.subject,
    value: payload.value ?? null,
    unit: String(payload.unit ?? ''),
    citations: clone(payload.citations ?? []),
    reason: payload.reason ?? '',
  }
}

function synthesisState(state) {
  const metrics = state.results
    .filter(item => item.kind === 'metric')
    .map(item => ({ metric: item.subject, value: item.value, unit: item.unit }))
  const citations = state.results.flatMap(item => item.citations)
  return {
    question_id: state.questionId,
    answer: `基于${state.results.length}项只读查询（metric/dimension）交叉核验后得出结论；全部执行计划已通过完成屏障。`,
    metrics,
    citations,
    confidence: 0.9,
  }
}

export function apply(ctx, config) {
  const states = new WeakMap()
  ctx.on('agent/created', ({ agent }) => {
    let setupStep = 'state'
    try {
    const state = {
      stage: 'identify',
      questionId: null,
      queue: [],
      cursor: 0,
      results: [],
      plans: [],
      stageToolCalls: [],
      tools: { metric: config.metricTool, dimension: config.dimensionTool },
    }
    states.set(agent, state)
    setupStep = 'system-prompt'
    agent.ctx.systemPrompt.section({
      name: 'native-business-analysis',
      order: 20,
      text: workflowPrompt(),
    })
    setupStep = 'submit-tool'
    agent.ctx.tools.register({
      name: SUBMIT_TOOL,
      description: 'Submit the current business-analysis stage result. Code validates order, tool calls, and the completion barrier.',
      parameters: {
        type: 'object',
        properties: {
          stage: { type: 'string' },
          payload: { type: 'object', additionalProperties: true },
        },
        required: ['stage', 'payload'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            accepted: { type: 'boolean' },
            next_stage: { type: 'string' },
            completed_plans: { type: 'integer' },
            next_task: {},
            synthesis_state: {},
          },
          required: ['accepted', 'next_stage', 'completed_plans'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args) {
        if (args.stage !== state.stage) throw new Error(`expected stage ${state.stage}, received ${args.stage}`)
        if (state.stage === 'identify') {
          const normalized = normalizeIdentification(args.payload, state.tools)
          state.questionId = normalized.questionId
          state.queue = normalized.queue
          state.plans = state.queue.map(item => ({
            plan_id: `plan-${item.id}`,
            kind: item.kind,
            subject_id: item.id,
            status: 'pending',
            tool_policy: [item.tool.replace('mcp__quality__', '')],
          }))
          state.cursor = 0
          state.stage = `execute/${state.queue[0].id}`
        } else if (state.stage.startsWith('execute/')) {
          const result = validateExecution(state, args.payload)
          state.results.push(result)
          state.plans[state.cursor].status = 'completed'
          state.cursor += 1
          if (state.cursor < state.queue.length) {
            state.stage = `execute/${state.queue[state.cursor].id}`
          } else {
            if (!state.plans.every(plan => plan.status === 'completed')) throw new Error('completion barrier blocked')
            state.stage = 'synthesize'
          }
        } else {
          throw new Error('synthesize is a tool-free terminal stage')
        }
        state.stageToolCalls = []
        const value = { accepted: true, next_stage: state.stage, completed_plans: state.results.length }
        if (state.stage.startsWith('execute/')) value.next_task = clone(state.queue[state.cursor])
        if (state.stage === 'synthesize') value.synthesis_state = synthesisState(state)
        return value
      },
    })
    setupStep = 'initial-restriction'
    agent.ctx.tools.restrict({ allow: Object.values(state.tools) })
    setupStep = 'stage-guard'
    agent.ctx.tools.guard((exec) => {
      if (exec.name === SUBMIT_TOOL) return undefined
      if (allowedEnterpriseTool(state, exec.name)) return undefined
      return `workflow stage ${state.stage} forbids tool ${exec.name}`
    })
    setupStep = 'tool-result-listener'
    agent.ctx.on('tools/result', (exec) => {
      if (exec.name !== SUBMIT_TOOL) state.stageToolCalls.push(exec.name)
    })
    } catch (error) {
      throw new Error(`native business setup failed at ${setupStep}: ${String(error)}`)
    }
  })
}
