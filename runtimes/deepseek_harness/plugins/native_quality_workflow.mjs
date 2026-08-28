/**
 * DSH/Cordis-native staged workflow controller for the v0.2 POC.
 *
 * Import-free by design: the bundled Runtime can load external ESM plugins,
 * while its private package graph is not exposed to Node module resolution.
 */

export const name = 'native-quality-workflow'
export const inject = ['agents', 'tools', 'systemPrompt']

const SUBMIT_TOOL = 'quality_workflow_submit'

function textOf(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  return content.map(block => block?.type === 'text' ? block.text : '').join('\n')
}

function assertArray(value, name, min = 1) {
  if (!Array.isArray(value) || value.length < min) {
    throw new Error(`${name} must contain at least ${min} item(s)`)
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function workflowPrompt() {
  return [
    'You are running under the code-governed quality workflow native_quality_v0.2.',
    `The only stage transition is a successful ${SUBMIT_TOOL} call.`,
    'The current stage and current task are authoritative in the latest quality_workflow_submit result; the initial stage is identify.',
    'Do not combine independent consumer needs, knowledge claims, or promises. Use only facts from the call and tool results.',
    'At identify: extract every consumer need, every agent policy/knowledge claim, and every concrete verifiable promise.',
    `Then call ${SUBMIT_TOOL} with stage="identify" and payload containing consumer_needs, knowledge_claims, promises.`,
    'For this complex acceptance sample, consumer_needs >= 3, knowledge_claims >= 2, promises >= 3.',
    'At execute/knowledge-1: call knowledge_search exactly twice before submitting: first a broad query without region/model, then a refined query using region, model and warranty context. Never submit after its first search.',
    'At every other execute/knowledge-N: call knowledge_search once; if decisive=true submit immediately and do not search again, otherwise refine using refinement_hints until decisive.',
    `After evidence is sufficient, call ${SUBMIT_TOOL} with the current stage and payload {status, search_rounds, evidence_refs, reason}.`,
    'At execute/promise-N: verify only next_task, call exactly its enterprise fact tool once, then submit {status, evidence_refs, reason}.',
    'The runtime keeps all enterprise tools visible for request-prefix stability, but code rejects every tool not allowed by the current stage.',
    'At synthesize: all plans passed the code barrier. Do not call any tool. Return synthesis_state from the latest submit result verbatim as plain JSON without a Markdown fence.',
  ].join('\n')
}

function allowedEnterpriseTool(state, name) {
  if (state.stage.startsWith('execute/knowledge-')) return name === state.tools.knowledge
  if (state.stage.startsWith('execute/promise-')) return name === state.queue[state.cursor].tool
  return false
}

function currentTask(state) {
  const item = state.queue[state.cursor]
  if (!item) return undefined
  return clone(item)
}

function synthesisState(state) {
  const knowledge = state.results.filter(item => item.claim_id)
  const promises = state.results.filter(item => item.promise_id)
  return {
    sample_id: state.sampleId,
    consumer_needs: clone(state.identification),
    knowledge_claims: clone(knowledge),
    promises: clone(promises),
    workflow: {
      stage_order: ['identify', 'plan', 'execute', 'barrier', 'synthesize'],
      plans: clone(state.plans),
      barrier_passed: true,
    },
    summary: `识别${state.identification.length}项消费者诉求；核验${knowledge.length}项知识陈述和${promises.length}项坐席承诺，全部执行计划已通过完成屏障。`,
  }
}

function normalizeIdentification(payload, tools) {
  assertArray(payload?.consumer_needs, 'consumer_needs', 3)
  assertArray(payload?.knowledge_claims, 'knowledge_claims', 2)
  assertArray(payload?.promises, 'promises', 3)
  const consumerNeeds = payload.consumer_needs.map((item, index) => ({
    need_id: `need-${index + 1}`,
    category: item.category,
    description: item.description,
    evidence_sequences: item.evidence_sequences,
  }))
  const knowledge = payload.knowledge_claims.map((item, index) => ({
    id: `knowledge-${index + 1}`,
    kind: 'knowledge',
    claim: item.claim,
    evidence_sequences: item.evidence_sequences,
    tool: tools.knowledge,
  }))
  const toolByType = {
    ticket: tools.ticket,
    sms: tools.sms,
    appointment: tools.appointment,
  }
  const promises = payload.promises.map((item, index) => {
    if (!toolByType[item.type]) throw new Error(`unsupported promise type: ${item.type}`)
    return {
      id: `promise-${index + 1}`,
      kind: 'promise',
      type: item.type,
      commitment: item.commitment,
      evidence_sequences: item.evidence_sequences,
      tool: toolByType[item.type],
    }
  })
  return { consumerNeeds, knowledge, promises }
}

function validateExecution(state, payload) {
  const current = state.queue[state.cursor]
  const calls = state.stageToolCalls
  if (current.kind === 'knowledge') {
    if (calls.some(name => name !== state.tools.knowledge)) {
      throw new Error('knowledge plan called a forbidden tool')
    }
    const minimum = current.id === 'knowledge-1' ? 2 : 1
    if (calls.length < minimum) throw new Error(`${current.id} requires at least ${minimum} knowledge_search call(s)`)
    assertArray(payload?.search_rounds, 'search_rounds', minimum)
    if (!['accurate', 'inaccurate', 'insufficient_evidence'].includes(payload?.status)) {
      throw new Error('invalid knowledge status')
    }
    return {
      claim_id: current.id,
      claim: current.claim,
      status: payload.status,
      search_rounds: clone(payload.search_rounds),
      evidence_refs: clone(payload.evidence_refs ?? []),
      reason: payload.reason,
    }
  }
  if (calls.length !== 1 || calls[0] !== current.tool) {
    throw new Error(`${current.id} must call exactly ${current.tool}`)
  }
  if (!['fulfilled', 'unfulfilled', 'mismatched', 'insufficient_evidence'].includes(payload?.status)) {
    throw new Error('invalid promise status')
  }
  return {
    promise_id: current.id,
    type: current.type,
    commitment: current.commitment,
    status: payload.status,
    tool: current.tool.replace('mcp__quality__', ''),
    evidence_refs: clone(payload.evidence_refs ?? []),
    reason: payload.reason,
  }
}

export function apply(ctx, config) {
  const states = new WeakMap()
  ctx.on('agent/created', ({ agent }) => {
    let setupStep = 'state'
    try {
    const state = {
      stage: 'identify',
      sampleId: null,
      identification: null,
      queue: [],
      cursor: 0,
      results: [],
      plans: [],
      stageToolCalls: [],
      tools: {
        knowledge: config.knowledgeTool,
        ticket: config.ticketTool,
        sms: config.smsTool,
        appointment: config.appointmentTool,
      },
    }
    states.set(agent, state)
    setupStep = 'system-prompt'
    agent.ctx.systemPrompt.section({
      name: 'native-quality-workflow',
      order: 20,
      text: workflowPrompt(),
    })
    setupStep = 'submit-tool'
    agent.ctx.tools.register({
      name: SUBMIT_TOOL,
      description: 'Submit the current quality-workflow stage result. Code validates order, evidence calls, and the completion barrier.',
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
          state.sampleId = textOf(agent.session?.events?.find(event => event.type === 'user/message')?.data?.message)
            .match(/"sample_id"\s*:\s*"([^"]+)"/)?.[1] ?? 'NATIVE-V02-001'
          state.identification = normalized.consumerNeeds
          state.queue = [...normalized.knowledge, ...normalized.promises]
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
        if (state.stage.startsWith('execute/')) value.next_task = currentTask(state)
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
      throw new Error(`native quality setup failed at ${setupStep}: ${String(error)}`)
    }
  })
}
