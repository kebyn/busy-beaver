# 忙碌海狸 Flask 演示

这是一个独立的 Flask 项目，演示经典二符号忙碌海狸图灵机。项目包含
2、3、4、5 状态机器注册表、稀疏纸带模拟器、JSON API 和浏览器动画界面。

## 运行

```bash
uv sync
uv run python -m unittest discover -v
uv run flask --app busy_beaver web
```

启动后打开 <http://127.0.0.1:5000/>。默认选择 3 状态机器，默认最大步数为
1000；5 状态记录机的完整运行需要约 4,700 万步，页面只演示前 1000 步。

也可以直接运行命令行模拟器，并用 `--trace-limit` 控制轨迹保存数量：

```bash
uv run python -m busy_beaver --machine busy_beaver_5 --max-steps 1000 --trace-limit 200
```

## API

- `GET /api/machines` 返回四台机器及其理论记录元数据。
- `POST /api/simulate` 接受 `machine`、`max_steps` 和 `trace_limit`，服务端将步数限制在安全上限内。

3 状态忙碌海狸存在两个分别优化的经典记录：得分冠军在 14 步留下 6 个
`1`，运行时间冠军在 21 步留下 5 个 `1`。注册表同时展示 `S(3)=21` 和
`Σ(3)=6` 这两个理论记录，模拟器保持真实转移表和纸带结果一致。
