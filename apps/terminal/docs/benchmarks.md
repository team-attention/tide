# Benchmarks

Tide Terminal has headless product benchmarks for repeatable terminal proof
work. They run without opening the GUI and use the same terminal backend and
WGPU renderer as the app.

## Terminal Core

Run:

```bash
cargo run -p tide-app -- benchmark terminal
```

For machine-readable output:

```bash
cargo run -p tide-app -- benchmark terminal --json
```

Useful options:

```bash
cargo run -p tide-app -- benchmark terminal --lines 20000 --cols 120 --rows 36 --resize-iterations 80
```

The benchmark reports:

| Metric | Meaning |
| --- | --- |
| `parse_ms` | Time to feed generated terminal output into the VT parser and terminal grid. |
| `parse_mib_per_second` | Parser throughput for the generated payload. |
| `sync_ms` | Time for the terminal sync path to publish a grid snapshot after output. |
| `search_ms` | Time to search scrollback and visible rows for the benchmark marker. |
| `resize_total_ms` / `resize_avg_ms` | Time to resize the terminal repeatedly and sync each result. |
| `history_lines` | Retained scrollback after the benchmark payload. |

## WGPU Render And Input Latency

Run:

```bash
cargo run -p tide-app -- benchmark render
```

For machine-readable output:

```bash
cargo run -p tide-app -- benchmark render --json
```

Useful options:

```bash
cargo run -p tide-app -- benchmark render --frames 240 --input-events 120 --cols 120 --rows 36
```

The render benchmark creates a headless WGPU device, builds Tide's real
`WgpuRenderer`, draws a terminal grid into the renderer's grid layer, submits
the frame to an offscreen texture, and waits for GPU completion. It also runs a
short input loop that feeds bytes into the terminal backend, syncs the grid,
builds renderer batches, submits to WGPU, and waits for completion.

The benchmark reports:

| Metric | Meaning |
| --- | --- |
| `frame_build_total_ms` / `frame_build_avg_ms` | CPU time to build renderer batches from the terminal grid. |
| `gpu_submit_total_ms` / `gpu_submit_avg_ms` | Time to encode the render pass, submit to WGPU, and wait for completion. |
| `frame_total_ms` / `frame_avg_ms` | Combined build and GPU-submit timing for steady frames. |
| `input_to_gpu_total_ms` / `input_to_gpu_avg_ms` | Time from generated input bytes through parser, grid sync, renderer build, WGPU submit, and GPU completion. |
| `adapter_name` / `adapter_backend` / `adapter_device_type` | The GPU adapter used for the run. |
| `texture_width` / `texture_height` | Offscreen render target size derived from terminal rows, columns, and measured cell metrics. |

## Scope

These benchmarks cover terminal core behavior, WGPU renderer batch building,
offscreen command submission, and headless input-to-GPU-complete latency. They
do not yet measure visible-window presentation latency, compositor frame pacing,
or live PTY input timing.
