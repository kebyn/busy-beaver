const config = window.BUSY_BEAVER_CONFIG;
const $ = (id) => document.getElementById(id);
const machineSelect = $("machine-select");
const maxStepsInput = $("max-steps");
const executionMode = $("execution-mode");
const speedMode = $("speed-mode");
let machines = {};
let worker;
let result = null;
let ready = false;
let failed = false;
let runId = 0;
let commandId = 0;
let sequence = 0;
let startupTimer;
let settingsValid = true;

function setText(id, value) { $(id).textContent = value; }

function updateButtons() {
  const terminal = ["halted", "limit", "error"].includes(result?.status);
  $("run").disabled = !ready || failed || !settingsValid || terminal || result?.status === "running";
  $("single-step").disabled = !ready || failed || !settingsValid || terminal;
  $("pause").disabled = !ready || failed;
  $("reset").disabled = !ready || failed;
}

function fatal(message) {
  clearTimeout(startupTimer);
  failed = true;
  ready = false;
  worker?.terminate();
  setText("result-badge", "执行错误");
  $("result-badge").dataset.status = "error";
  setText("halt-message", message);
  $("halt-message").className = "halt-message error";
  updateButtons();
}

function drawTape(data) {
  const cells = data.tape_window.map(({ position, value }) => {
    const cell = document.createElement("span");
    cell.className = "cell" + (value ? " one" : "") + (position === data.head_position ? " head" : "");
    cell.dataset.position = position;
    cell.dataset.value = value;
    const coordinate = document.createElement("span");
    coordinate.className = "position";
    coordinate.textContent = position;
    cell.append(coordinate, String(value));
    return cell;
  });
  $("tape").replaceChildren(...cells);
}

function drawTrace(data) {
  $("trace").replaceChildren(...data.trace.map((step) => {
    const item = document.createElement("li");
    item.textContent = `#${step.step}: ${step.state} @ ${step.position} 读 ${step.read} → 写 ${step.write}，${step.direction}，${step.next_state}`;
    return item;
  }));
}

function drawComparison(machine, data) {
  const rows = [
    ["理论步数纪录 S(n)", machine.theoretical_steps.toLocaleString()],
    ["理论得分纪录 Σ(n)", machine.theoretical_ones.toLocaleString()],
    ["本次已执行步数", data.steps_executed.toLocaleString()],
    ["当前纸带 1 数量", data.ones.toLocaleString()],
  ];
  $("comparison-list").replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    row.append(term, detail);
    return row;
  }));
}

function draw(data) {
  result = data;
  setText("state", data.state);
  setText("steps", data.steps_executed.toLocaleString());
  setText("head", data.head_position);
  setText("ones", data.ones.toLocaleString());
  drawTape(data);
  drawTrace(data);
  const labels = { idle: "尚未运行", running: "运行中", paused: "已暂停", limit: "达到上限", halted: "已停机", error: "执行错误" };
  setText("result-badge", labels[data.status]);
  $("result-badge").dataset.status = data.status;
  const messages = {
    idle: "空白纸带已就绪。点击运行或单步开始。",
    running: "正在执行，可随时暂停或单步。",
    paused: "已暂停，运行将从当前纸带继续；单步只执行一次转移。",
    limit: data.executionMode === "until-halt"
      ? `未停机：达到 50,000,000 步保护上限。`
      : `未停机：达到最大步数（${data.limit.toLocaleString()} 步）。提高上限或选择运行到停机后可继续。`,
    halted: `已执行到 H，真实停机：${data.steps_executed.toLocaleString()} 步，${data.ones.toLocaleString()} 个 1。`,
    error: `执行终止：${data.error}`,
  };
  setText("halt-message", messages[data.status]);
  const tone = data.halted ? "good" : data.status === "limit" ? "limit" : data.status === "error" ? "error" : "";
  $("result-badge").className = `badge ${tone}`;
  $("halt-message").className = `halt-message ${tone}`;
  drawComparison(machines[data.machine], data);
  const speed = data.status === "running"
    ? data.delay === 0 ? `高速计算，约 ${Math.round(data.stepsPerSecond).toLocaleString()} 步/秒` : `${data.delay.toLocaleString()} 毫秒/步`
    : labels[data.status];
  const bound = data.executionMode === "until-halt" ? "保护上限" : "步数上限";
  setText("playback-info", `${speed} · 已执行 ${data.steps_executed.toLocaleString()} / ${bound} ${data.limit.toLocaleString()} 步`);
  $("progress").max = Math.max(1, data.limit);
  $("progress").value = Math.min(data.steps_executed, data.limit);
  updateButtons();
}

function settings() {
  const maxSteps = executionMode.value === "until-halt" ? config.defaultMaxSteps
    : maxStepsInput.value.trim() === "" ? NaN : Number(maxStepsInput.value);
  if (!Number.isInteger(maxSteps) || maxSteps < 0 || maxSteps > config.maxServerSteps) {
    throw new Error(`最大步数必须是 0 到 ${config.maxServerSteps.toLocaleString()} 之间的整数。`);
  }
  return { maxSteps, interval: Number($("speed").value), executionMode: executionMode.value, speedMode: speedMode.value };
}

function send(type, extra = {}) {
  if (!worker || failed) return;
  worker.postMessage({ type, runId, commandId: ++commandId, ...extra });
}

function reset() {
  if (failed) return;
  try {
    // Reset must remain usable while an invalid limit is being edited.
    if (!settingsValid) maxStepsInput.value = config.defaultMaxSteps;
    const nextSettings = settings();
    ready = false;
    settingsValid = true;
    result = null;
    runId++;
    sequence = 0;
    updateButtons();
    setText("settings-error", "");
    const machine = machines[machineSelect.value];
    setText("machine-note", machine.state_count === 5
      ? "五状态默认运行到停机，设 50,000,000 步保护上限。自动加速会逐次执行全部转移，高速画面约每 100 毫秒刷新。"
      : machine.state_count === 3
      ? "当前为三状态得分冠军：14 步留下 6 个 1；21 步的时间冠军是另一台机器。"
      : `理论纪录：${machine.theoretical_steps.toLocaleString()} 步，${machine.theoretical_ones.toLocaleString()} 个 1。`);
    send("init", { machine, settings: nextSettings });
  } catch (error) { setText("settings-error", error.message); }
}

function configure() {
  if (!ready || failed) return;
  try {
    send("configure", { settings: settings() });
    settingsValid = true;
    setText("settings-error", "");
  } catch (error) {
    send("pause");
    settingsValid = false;
    setText("settings-error", error.message);
  }
  updateButtons();
}

$("run").addEventListener("click", () => send("run"));
$("pause").addEventListener("click", () => send("pause"));
$("single-step").addEventListener("click", () => send("step"));
$("reset").addEventListener("click", reset);
function updateSettingsControls() {
  maxStepsInput.disabled = executionMode.value === "until-halt";
  $("speed").disabled = speedMode.value !== "fixed";
}

machineSelect.addEventListener("change", () => {
  maxStepsInput.value = config.defaultMaxSteps;
  executionMode.value = machines[machineSelect.value]?.state_count === 5 ? "until-halt" : "limited";
  updateSettingsControls();
  reset();
});
for (const control of [executionMode, speedMode]) {
  control.addEventListener("change", () => { updateSettingsControls(); configure(); });
}
maxStepsInput.addEventListener("input", configure);
$("speed").addEventListener("input", (event) => {
  setText("speed-value", event.target.value);
  configure();
});

async function start() {
  updateButtons();
  try {
    const response = await fetch("/api/machines", { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`机器数据加载失败（HTTP ${response.status}）。`);
    const data = await response.json();
    if (!Array.isArray(data.machines) || data.machines.length !== 4) throw new Error("机器数据不完整。");
    machines = Object.fromEntries(data.machines.map((machine) => [machine.id, machine]));
    for (const option of machineSelect.options) {
      if (!machines[option.value]?.transitions) throw new Error("机器数据缺少转移表。");
    }
    worker = new Worker(new URL("./simulation-worker.js", import.meta.url), { type: "module" });
    worker.onerror = (event) => { event.preventDefault(); fatal(`Worker 启动或执行失败：${event.message}`); };
    worker.onmessageerror = () => fatal("无法读取 Worker 执行结果，请刷新页面重试。");
    worker.onmessage = ({ data: snapshot }) => {
      // Worker commands are FIFO. Reject frames predating the latest requested
      // command, including already queued playback frames and previous runs.
      if (failed || snapshot.runId !== runId || snapshot.commandId < commandId) return;
      if (snapshot.type === "failure") { fatal(snapshot.error); return; }
      if (snapshot.type !== "snapshot" || snapshot.sequence <= sequence) return;
      clearTimeout(startupTimer);
      sequence = snapshot.sequence;
      ready = true;
      draw(snapshot);
    };
    startupTimer = setTimeout(() => fatal("Worker 启动超时，请刷新页面重试。"), 5000);
    reset();
  } catch (error) { fatal(`无法初始化模拟器：${error.message}`); }
}

start();
