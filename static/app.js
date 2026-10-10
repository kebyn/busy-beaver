(() => {
  const config = window.BUSY_BEAVER_CONFIG;
  const $ = (id) => document.getElementById(id);
  const machineSelect = $("machine-select");
  const maxStepsInput = $("max-steps");
  const traceLimit = 200;
  let machines = {};
  let result = null;
  let playing = false;
  let timer = null;
  let frame = 0;

  function setText(id, value) { $(id).textContent = value; }

  function drawTape(data) {
    const tape = $("tape");
    tape.replaceChildren();
    const entries = Object.entries(data.tape_window || {}).map(([position, value]) => [Number(position), value]);
    entries.forEach(([position, value]) => {
      const cell = document.createElement("span");
      cell.className = "cell" + (value ? " one" : "") + (position === data.head_position ? " head" : "");
      cell.innerHTML = `<span class="position">${position}</span>${value}`;
      tape.appendChild(cell);
    });
  }

  function drawTrace(data, visible = data.trace || []) {
    const list = $("trace");
    list.replaceChildren();
    visible.forEach((step) => {
      const item = document.createElement("li");
      item.textContent = `#${step.step}: ${step.state} @ ${step.position} 读 ${step.read} → 写 ${step.write}，${step.direction}，${step.next_state}`;
      list.appendChild(item);
    });
  }

  function drawComparison(machine, data) {
    const expected = machine ? `理论 ${machine.theoretical_steps.toLocaleString()} 步` : "—";
    const expectedOnes = machine ? `理论 ${machine.theoretical_ones.toLocaleString()} 个` : "—";
    $("comparison-list").innerHTML = `
      <div><dt>理论步数</dt><dd>${expected}</dd></div>
      <div><dt>理论最终 1 数量</dt><dd>${expectedOnes}</dd></div>
      <div><dt>本次步数</dt><dd>${data ? data.steps_executed.toLocaleString() : "—"}</dd></div>
      <div><dt>本次最终 1 数量</dt><dd>${data ? data.ones.toLocaleString() : "—"}</dd></div>`;
  }

  function draw(data, visibleTrace = data.trace || []) {
    result = data;
    setText("state", data.state);
    setText("steps", data.steps_executed.toLocaleString());
    setText("head", data.head_position);
    setText("ones", data.ones.toLocaleString());
    drawTape(data);
    drawTrace(data, visibleTrace);
    const badge = $("result-badge");
    const message = $("halt-message");
    badge.className = "badge";
    message.className = "halt-message";
    if (data.halted) {
      badge.textContent = "已停机";
      badge.classList.add("good");
      message.textContent = `已停机：${data.halt_reason}。`;
      message.classList.add("good");
    } else if (data.halt_reason === "maximum step limit reached") {
      badge.textContent = "达到上限";
      badge.classList.add("limit");
      message.textContent = `未停机：达到最大步数（${data.steps_executed.toLocaleString()} 步）。`;
      message.classList.add("limit");
    } else {
      badge.textContent = "执行结束";
      message.textContent = `执行结束：${data.halt_reason}。`;
    }
    drawComparison(machines[machineSelect.value], data);
  }

  function updateMachineNote() {
    const machine = machines[machineSelect.value];
    if (!machine) return;
    const longRun = machine.state_count === 5
      ? "5 状态记录机完整运行约 4,700 万步；网页默认只演示前 1,000 步。"
      : machine.description;
    $("machine-note").textContent = `${longRun} 理论记录：${machine.theoretical_steps.toLocaleString()} 步、${machine.theoretical_ones.toLocaleString()} 个 1。`;
    drawComparison(machine, result);
  }

  async function simulate(maxSteps = Number(maxStepsInput.value)) {
    stop();
    if (!Number.isInteger(maxSteps) || maxSteps < 0 || maxSteps > config.maxServerSteps) {
      $("halt-message").textContent = `最大步数必须在 0 到 ${config.maxServerSteps.toLocaleString()} 之间。`;
      return;
    }
    const response = await fetch("/api/simulate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machine: machineSelect.value, max_steps: maxSteps, trace_limit: traceLimit })
    });
    const data = await response.json();
    if (!response.ok) { $("halt-message").textContent = data.error || "请求失败"; return; }
    frame = 0;
    draw(data, []);
    if (data.trace.length) playTrace(data);
  }

  function playTrace(data) {
    playing = true;
    const tick = () => {
      if (!playing || frame >= data.trace.length) { playing = false; return; }
      const step = data.trace[frame++];
      draw(data, data.trace.slice(0, frame));
      setText("state", step.next_state === "H" ? "HALT" : step.next_state);
      setText("steps", step.step.toLocaleString());
      setText("head", step.next_position);
      timer = setTimeout(tick, Number($("speed").value));
    };
    tick();
  }

  function stop() { playing = false; if (timer) clearTimeout(timer); timer = null; }

  $("run").addEventListener("click", () => simulate());
  $("pause").addEventListener("click", stop);
  $("single-step").addEventListener("click", () => simulate(Math.min(1, Number(maxStepsInput.value))));
  $("reset").addEventListener("click", () => { stop(); result = null; draw({ state: "A", steps_executed: 0, head_position: 0, ones: 0, tape_window: {}, trace: [], halted: false, halt_reason: "尚未运行" }, []); updateMachineNote(); });
  machineSelect.addEventListener("change", () => { stop(); result = null; updateMachineNote(); });
  $("speed").addEventListener("input", (event) => setText("speed-value", event.target.value));

  fetch("/api/machines").then((response) => response.json()).then((data) => {
    data.machines.forEach((machine) => { machines[machine.id] = machine; });
    updateMachineNote();
    draw({ state: "A", steps_executed: 0, head_position: 0, ones: 0, tape_window: {}, trace: [], halted: false, halt_reason: "尚未运行" }, []);
  });
})();
