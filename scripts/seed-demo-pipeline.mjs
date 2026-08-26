/** 08-27 用户链路 E2E：数据接入→数据定义→任务创建→按 flow run→run 出结果。
 *  用法：node scripts/seed-demo-pipeline.mjs */
const B = "http://localhost:8100";
const j = (r) => r.json();
const post = (p, body) => fetch(`${B}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(j);
const get = (p) => fetch(`${B}${p}`).then(j);
const put = (p, body) => fetch(`${B}${p}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(j);

// 1 数据接入
const asset = await post("/api/data-assets", {
  name: "DEMO-弹幕质检数据",
  rows: [
    { text: "这个云朵白2.0有什么优惠吗？", shop: "博世家电京东自营旗舰店" },
    { text: "主播在吗？西门子大卖是什么活动", shop: "西门子家电天猫厨卫旗舰店" },
  ],
});
console.log("1 数据接入 asset:", asset.id);

// 2 数据定义
const def = await post("/api/data-definitions", {
  name: "DEMO-弹幕字段定义", assetId: asset.id,
  fieldSchema: [
    { key: "text", type: "string", label: "弹幕内容" },
    { key: "shop", type: "string", label: "归属店铺" },
  ],
});
console.log("2 数据定义:", def.id);

// 3 工作流：data-read → loop(llm) → create-record
const wf = await post("/api/workflows", { name: "DEMO-弹幕质检流" });
const d = await get(`/api/workflows/${wf.id}`);
const dn = d.definition;
dn.graph.nodes = [
  { id: "n_start", type: "input", name: "开始", config: {}, inputs: [] },
  { id: "n_read", type: "data-read", name: "读取弹幕", config: { dataAssetId: asset.id, window: "all", sampling: "all" }, inputs: [] },
  { id: "n_loop", type: "loop", name: "逐条质检", config: { iteratorRef: "{{n_read.outputs.rows}}", itemVar: "item", indexVar: "index", maxIterations: 10 }, inputs: [] },
  { id: "n_llm", type: "llm", name: "质检判断", config: { modelRef: { modelId: "qwen-plus" }, prompt: "质检以下弹幕是否违规，输出结论：{{n_loop.outputs.item.text}}（店铺：{{n_loop.outputs.item.shop}}）" }, inputs: [] },
  { id: "n_rec", type: "create-record", name: "落质检结果", config: { outputKey: "quality_result" }, inputs: [] },
];
dn.graph.edges = [
  { id: "e1", source: "n_start", target: "n_read" },
  { id: "e2", source: "n_read", target: "n_loop" },
  { id: "e3", source: "n_loop", sourceHandle: "body", target: "n_llm" },
  { id: "e4", source: "n_llm", target: "n_loop" },
  { id: "e5", source: "n_loop", sourceHandle: "done", target: "n_rec" },
];
dn.ui.positions = { n_start: { x: 40, y: 160 }, n_read: { x: 380, y: 160 }, n_loop: { x: 720, y: 160 }, n_llm: { x: 720, y: 420 }, n_rec: { x: 1060, y: 160 } };
await put(`/api/workflows/${wf.id}/draft`, { definition: dn, baseRevision: d.draftRevision });
console.log("3 工作流:", wf.id);

// 4 任务创建
const task = await post("/api/tasks", {
  name: "DEMO-每日弹幕质检", workflowId: wf.id, dataAssetId: asset.id, dataDefinitionId: def.id,
  sampling: "all", dataWindow: "last_7d",
});
console.log("4 任务:", task.id ?? task);

// 5 按 flow run
const br = await post(`/api/tasks/${task.id}/batch-run`, { limit: 2 });
console.log("5 runs:", br.runIds?.length);
for (const rid of br.runIds ?? []) {
  const r = await get(`/api/runs/${rid}`);
  console.log("   run", rid.slice(0, 8), r.status);
}

// 6 run 出结果
const qr = await get(`/api/quality-results?page=1&pageSize=5`);
console.log("6 质检结果数:", qr.total, "首条:", JSON.stringify((qr.items?.[0] ?? {}).structured_output ?? {}).slice(0, 120));
console.log("E2E OK");
