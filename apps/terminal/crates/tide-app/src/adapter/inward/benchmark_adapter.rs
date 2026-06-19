//! Headless product benchmarks for terminal-product proof work.
//!
//! These benchmarks intentionally run through the same Terminal backend and WGPU
//! renderer used by the app, but avoid launching the GUI.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::tide_core::{Renderer, Size, TerminalBackend, Vec2};
use crate::tide_renderer::WgpuRenderer;

const DEFAULT_LINES: usize = 10_000;
const DEFAULT_COLS: u16 = 100;
const DEFAULT_ROWS: u16 = 32;
const DEFAULT_RESIZE_ITERATIONS: usize = 40;
const DEFAULT_RENDER_FRAMES: usize = 120;
const DEFAULT_RENDER_INPUT_EVENTS: usize = 60;
const MAX_LINES: usize = 200_000;
const MAX_COLS: u16 = 500;
const MAX_ROWS: u16 = 200;
const MAX_RESIZE_ITERATIONS: usize = 1_000;
const MAX_RENDER_FRAMES: usize = 2_000;
const MAX_RENDER_INPUT_EVENTS: usize = 2_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TerminalBenchmarkOptions {
    pub json: bool,
    pub lines: usize,
    pub cols: u16,
    pub rows: u16,
    pub resize_iterations: usize,
}

impl Default for TerminalBenchmarkOptions {
    fn default() -> Self {
        Self {
            json: false,
            lines: DEFAULT_LINES,
            cols: DEFAULT_COLS,
            rows: DEFAULT_ROWS,
            resize_iterations: DEFAULT_RESIZE_ITERATIONS,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct TerminalBenchmarkReport {
    pub benchmark: &'static str,
    pub version: &'static str,
    pub lines: usize,
    pub bytes: usize,
    pub cols: u16,
    pub rows: u16,
    pub history_lines: usize,
    pub search_matches: usize,
    pub parse_ms: f64,
    pub parse_mib_per_second: f64,
    pub sync_ms: f64,
    pub search_ms: f64,
    pub resize_iterations: usize,
    pub resize_total_ms: f64,
    pub resize_avg_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RenderBenchmarkOptions {
    pub json: bool,
    pub frames: usize,
    pub input_events: usize,
    pub cols: u16,
    pub rows: u16,
}

impl Default for RenderBenchmarkOptions {
    fn default() -> Self {
        Self {
            json: false,
            frames: DEFAULT_RENDER_FRAMES,
            input_events: DEFAULT_RENDER_INPUT_EVENTS,
            cols: 120,
            rows: 36,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct RenderBenchmarkReport {
    pub benchmark: &'static str,
    pub version: &'static str,
    pub frames: usize,
    pub input_events: usize,
    pub cols: u16,
    pub rows: u16,
    pub cells: usize,
    pub texture_width: u32,
    pub texture_height: u32,
    pub adapter_name: String,
    pub adapter_backend: String,
    pub adapter_device_type: String,
    pub frame_build_total_ms: f64,
    pub frame_build_avg_ms: f64,
    pub gpu_submit_total_ms: f64,
    pub gpu_submit_avg_ms: f64,
    pub frame_total_ms: f64,
    pub frame_avg_ms: f64,
    pub input_to_gpu_total_ms: f64,
    pub input_to_gpu_avg_ms: f64,
}

pub(crate) fn run_benchmark(args: &[String]) -> i32 {
    match run_benchmark_inner(args) {
        Ok(output) => {
            println!("{output}");
            0
        }
        Err(message) => {
            eprintln!("{message}");
            eprintln!("{}", usage());
            2
        }
    }
}

fn run_benchmark_inner(args: &[String]) -> Result<String, String> {
    if args.is_empty() || args[0] == "--help" || args[0] == "-h" {
        return Ok(usage());
    }
    match args[0].as_str() {
        "terminal" => {
            let options = parse_terminal_options(&args[1..])?;
            let report = run_terminal_benchmark(&options).map_err(|err| err.to_string())?;
            if options.json {
                serde_json::to_string_pretty(&report).map_err(|err| err.to_string())
            } else {
                Ok(format_terminal_report(&report))
            }
        }
        "render" => {
            let options = parse_render_options(&args[1..])?;
            let report = run_render_benchmark(&options).map_err(|err| err.to_string())?;
            if options.json {
                serde_json::to_string_pretty(&report).map_err(|err| err.to_string())
            } else {
                Ok(format_render_report(&report))
            }
        }
        target => Err(format!("unknown benchmark target '{target}'")),
    }
}

fn parse_terminal_options(args: &[String]) -> Result<TerminalBenchmarkOptions, String> {
    let mut options = TerminalBenchmarkOptions::default();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--json" => {
                options.json = true;
                i += 1;
            }
            "--lines" => {
                let value = parse_next_usize(args, i, "--lines")?;
                options.lines = value.clamp(1, MAX_LINES);
                i += 2;
            }
            "--cols" => {
                let value = parse_next_u16(args, i, "--cols")?;
                options.cols = value.clamp(20, MAX_COLS);
                i += 2;
            }
            "--rows" => {
                let value = parse_next_u16(args, i, "--rows")?;
                options.rows = value.clamp(5, MAX_ROWS);
                i += 2;
            }
            "--resize-iterations" => {
                let value = parse_next_usize(args, i, "--resize-iterations")?;
                options.resize_iterations = value.clamp(1, MAX_RESIZE_ITERATIONS);
                i += 2;
            }
            flag => return Err(format!("unknown benchmark option '{flag}'")),
        }
    }
    Ok(options)
}

fn parse_render_options(args: &[String]) -> Result<RenderBenchmarkOptions, String> {
    let mut options = RenderBenchmarkOptions::default();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--json" => {
                options.json = true;
                i += 1;
            }
            "--frames" => {
                let value = parse_next_usize(args, i, "--frames")?;
                options.frames = value.clamp(1, MAX_RENDER_FRAMES);
                i += 2;
            }
            "--input-events" => {
                let value = parse_next_usize(args, i, "--input-events")?;
                options.input_events = value.clamp(1, MAX_RENDER_INPUT_EVENTS);
                i += 2;
            }
            "--cols" => {
                let value = parse_next_u16(args, i, "--cols")?;
                options.cols = value.clamp(20, MAX_COLS);
                i += 2;
            }
            "--rows" => {
                let value = parse_next_u16(args, i, "--rows")?;
                options.rows = value.clamp(5, MAX_ROWS);
                i += 2;
            }
            flag => return Err(format!("unknown benchmark option '{flag}'")),
        }
    }
    Ok(options)
}

fn parse_next_usize(args: &[String], index: usize, flag: &str) -> Result<usize, String> {
    args.get(index + 1)
        .ok_or_else(|| format!("{flag} requires a value"))?
        .parse::<usize>()
        .map_err(|_| format!("{flag} requires an integer value"))
}

fn parse_next_u16(args: &[String], index: usize, flag: &str) -> Result<u16, String> {
    args.get(index + 1)
        .ok_or_else(|| format!("{flag} requires a value"))?
        .parse::<u16>()
        .map_err(|_| format!("{flag} requires an integer value"))
}

fn run_terminal_benchmark(
    options: &TerminalBenchmarkOptions,
) -> Result<TerminalBenchmarkReport, Box<dyn std::error::Error>> {
    let mut terminal = crate::tide_terminal::Terminal::new(options.cols, options.rows)?;
    terminal.bench_sync_grid();

    let payload = build_terminal_payload(options.lines, options.cols);

    let parse_duration = elapsed(|| {
        terminal.bench_write_to_term(&payload);
    });
    let sync_duration = elapsed(|| {
        terminal.bench_sync_grid();
    });

    let (search_matches, search_duration) =
        elapsed_with_result(|| terminal.search_buffer("needle"));
    let resize_duration = elapsed(|| {
        for i in 0..options.resize_iterations {
            let cols = if i % 2 == 0 {
                options.cols.saturating_add(17).min(MAX_COLS)
            } else {
                options.cols
            };
            let rows = if i % 2 == 0 {
                options.rows.saturating_add(7).min(MAX_ROWS)
            } else {
                options.rows
            };
            terminal.resize(cols, rows);
            terminal.bench_sync_grid();
        }
        terminal.resize(options.cols, options.rows);
        terminal.bench_sync_grid();
    });

    let bytes = payload.len();
    Ok(TerminalBenchmarkReport {
        benchmark: "terminal_product_core",
        version: env!("CARGO_PKG_VERSION"),
        lines: options.lines,
        bytes,
        cols: options.cols,
        rows: options.rows,
        history_lines: terminal.history_size(),
        search_matches: search_matches.len(),
        parse_ms: millis(parse_duration),
        parse_mib_per_second: mib_per_second(bytes, parse_duration),
        sync_ms: millis(sync_duration),
        search_ms: millis(search_duration),
        resize_iterations: options.resize_iterations,
        resize_total_ms: millis(resize_duration),
        resize_avg_ms: millis(resize_duration) / options.resize_iterations as f64,
    })
}

fn run_render_benchmark(
    options: &RenderBenchmarkOptions,
) -> Result<RenderBenchmarkReport, Box<dyn std::error::Error>> {
    let mut terminal = crate::tide_terminal::Terminal::new(options.cols, options.rows)?;
    terminal.bench_sync_grid();
    terminal.bench_write_to_term(&build_terminal_payload(
        (options.rows as usize).saturating_mul(4),
        options.cols,
    ));
    terminal.bench_sync_grid();

    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        ..Default::default()
    });
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: None,
        force_fallback_adapter: false,
    }))
    .ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "no suitable WGPU adapter found for headless render benchmark",
        )
    })?;
    let adapter_info = adapter.get_info();
    let (device, queue) = pollster::block_on(adapter.request_device(
        &wgpu::DeviceDescriptor {
            label: Some("tide_benchmark_device"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            memory_hints: Default::default(),
        },
        None,
    ))?;
    let device = Arc::new(device);
    let queue = Arc::new(queue);
    let format = wgpu::TextureFormat::Bgra8Unorm;
    let mut renderer = WgpuRenderer::new(Arc::clone(&device), Arc::clone(&queue), format, 1.0);
    let cell_size = renderer.cell_size();
    let screen_size = Size::new(
        options.cols as f32 * cell_size.width,
        options.rows as f32 * cell_size.height,
    );
    let texture_width = screen_size.width.ceil().max(1.0) as u32;
    let texture_height = screen_size.height.ceil().max(1.0) as u32;
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("tide_benchmark_render_texture"),
        size: wgpu::Extent3d {
            width: texture_width,
            height: texture_height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());

    build_render_frame(&mut renderer, terminal.grid(), screen_size);
    submit_render_frame(&device, &queue, &mut renderer, &view);

    let mut frame_build_total = Duration::ZERO;
    let mut gpu_submit_total = Duration::ZERO;
    let mut frame_total = Duration::ZERO;
    for _ in 0..options.frames {
        let started = Instant::now();
        let build = elapsed(|| build_render_frame(&mut renderer, terminal.grid(), screen_size));
        let submit = elapsed(|| submit_render_frame(&device, &queue, &mut renderer, &view));
        frame_build_total += build;
        gpu_submit_total += submit;
        frame_total += started.elapsed();
    }

    let mut input_to_gpu_total = Duration::ZERO;
    for event_index in 0..options.input_events {
        input_to_gpu_total += elapsed(|| {
            let payload = build_render_input_payload(event_index, options.cols);
            terminal.bench_write_to_term(&payload);
            terminal.bench_sync_grid();
            build_render_frame(&mut renderer, terminal.grid(), screen_size);
            submit_render_frame(&device, &queue, &mut renderer, &view);
        });
    }

    Ok(RenderBenchmarkReport {
        benchmark: "terminal_wgpu_render",
        version: env!("CARGO_PKG_VERSION"),
        frames: options.frames,
        input_events: options.input_events,
        cols: options.cols,
        rows: options.rows,
        cells: options.cols as usize * options.rows as usize,
        texture_width,
        texture_height,
        adapter_name: adapter_info.name,
        adapter_backend: format!("{:?}", adapter_info.backend),
        adapter_device_type: format!("{:?}", adapter_info.device_type),
        frame_build_total_ms: millis(frame_build_total),
        frame_build_avg_ms: millis(frame_build_total) / options.frames as f64,
        gpu_submit_total_ms: millis(gpu_submit_total),
        gpu_submit_avg_ms: millis(gpu_submit_total) / options.frames as f64,
        frame_total_ms: millis(frame_total),
        frame_avg_ms: millis(frame_total) / options.frames as f64,
        input_to_gpu_total_ms: millis(input_to_gpu_total),
        input_to_gpu_avg_ms: millis(input_to_gpu_total) / options.input_events as f64,
    })
}

fn build_terminal_payload(lines: usize, cols: u16) -> Vec<u8> {
    let line_width = (cols as usize).saturating_sub(8).clamp(24, 160);
    let mut payload = String::with_capacity(lines * (line_width + 2));
    for line in 0..lines {
        let marker = if line % 97 == 0 { "needle" } else { "plain" };
        let mut row = format!("tide bench {line:06} {marker} ");
        while row.len() < line_width {
            row.push_str("alpha beta gamma ");
        }
        row.truncate(line_width);
        payload.push_str(&row);
        payload.push_str("\r\n");
    }
    payload.into_bytes()
}

fn build_render_input_payload(event_index: usize, cols: u16) -> Vec<u8> {
    let line_width = (cols as usize).saturating_sub(8).clamp(24, 160);
    let mut row = if event_index % 4 == 0 {
        format!("\r\ntide input {event_index:06} ")
    } else {
        format!("\rtide input {event_index:06} ")
    };
    while row.len() < line_width {
        row.push_str("latency sample ");
    }
    row.truncate(line_width);
    row.push_str("\x1b[K");
    row.into_bytes()
}

fn build_render_frame(
    renderer: &mut WgpuRenderer,
    grid: &crate::tide_core::TerminalGrid,
    screen_size: Size,
) {
    renderer.begin_frame(screen_size);
    renderer.begin_pane_grid(1);
    let cell_size = renderer.cell_size();
    let offset = Vec2::new(0.0, 0.0);
    let rows = (grid.rows as usize).min(grid.cells.len());
    let cols = grid.cols as usize;
    for row in 0..rows {
        renderer.draw_grid_row(&grid.cells[row], row, cols, cell_size, offset);
    }
    renderer.end_pane_grid();
    renderer.assemble_grid(&[1]);
    renderer.end_frame();
}

fn submit_render_frame(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    renderer: &mut WgpuRenderer,
    view: &wgpu::TextureView,
) {
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("tide_benchmark_render_encoder"),
    });
    renderer.render_frame(&mut encoder, view);
    queue.submit(std::iter::once(encoder.finish()));
    device.poll(wgpu::Maintain::Wait);
}

fn elapsed(work: impl FnOnce()) -> Duration {
    let start = Instant::now();
    work();
    start.elapsed()
}

fn elapsed_with_result<T>(work: impl FnOnce() -> T) -> (T, Duration) {
    let start = Instant::now();
    let result = work();
    (result, start.elapsed())
}

fn millis(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

fn mib_per_second(bytes: usize, duration: Duration) -> f64 {
    let seconds = duration.as_secs_f64();
    if seconds <= f64::EPSILON {
        return 0.0;
    }
    bytes as f64 / 1024.0 / 1024.0 / seconds
}

fn format_terminal_report(report: &TerminalBenchmarkReport) -> String {
    format!(
        "\
Tide Terminal benchmark: {benchmark}
version: {version}
size: {lines} lines, {bytes} bytes, {cols}x{rows}
parse: {parse_ms:.3} ms ({parse_mib_per_second:.2} MiB/s)
grid sync: {sync_ms:.3} ms
search: {search_ms:.3} ms ({search_matches} matches)
resize: {resize_total_ms:.3} ms total, {resize_avg_ms:.3} ms avg ({resize_iterations} iterations)
history: {history_lines} lines",
        benchmark = report.benchmark,
        version = report.version,
        lines = report.lines,
        bytes = report.bytes,
        cols = report.cols,
        rows = report.rows,
        parse_ms = report.parse_ms,
        parse_mib_per_second = report.parse_mib_per_second,
        sync_ms = report.sync_ms,
        search_ms = report.search_ms,
        search_matches = report.search_matches,
        resize_total_ms = report.resize_total_ms,
        resize_avg_ms = report.resize_avg_ms,
        resize_iterations = report.resize_iterations,
        history_lines = report.history_lines,
    )
}

fn format_render_report(report: &RenderBenchmarkReport) -> String {
    format!(
        "\
Tide Terminal benchmark: {benchmark}
version: {version}
size: {cols}x{rows} ({cells} cells), offscreen texture {texture_width}x{texture_height}
adapter: {adapter_name} ({adapter_backend}, {adapter_device_type})
frames: {frames}
frame build: {frame_build_total_ms:.3} ms total, {frame_build_avg_ms:.3} ms avg
gpu submit: {gpu_submit_total_ms:.3} ms total, {gpu_submit_avg_ms:.3} ms avg
frame total: {frame_total_ms:.3} ms total, {frame_avg_ms:.3} ms avg
input to GPU complete: {input_to_gpu_total_ms:.3} ms total, {input_to_gpu_avg_ms:.3} ms avg ({input_events} events)",
        benchmark = report.benchmark,
        version = report.version,
        cols = report.cols,
        rows = report.rows,
        cells = report.cells,
        texture_width = report.texture_width,
        texture_height = report.texture_height,
        adapter_name = report.adapter_name,
        adapter_backend = report.adapter_backend,
        adapter_device_type = report.adapter_device_type,
        frames = report.frames,
        frame_build_total_ms = report.frame_build_total_ms,
        frame_build_avg_ms = report.frame_build_avg_ms,
        gpu_submit_total_ms = report.gpu_submit_total_ms,
        gpu_submit_avg_ms = report.gpu_submit_avg_ms,
        frame_total_ms = report.frame_total_ms,
        frame_avg_ms = report.frame_avg_ms,
        input_to_gpu_total_ms = report.input_to_gpu_total_ms,
        input_to_gpu_avg_ms = report.input_to_gpu_avg_ms,
        input_events = report.input_events,
    )
}

fn usage() -> String {
    "\
Usage:
  tide-terminal benchmark terminal [--json] [--lines N] [--cols N] [--rows N] [--resize-iterations N]
  tide-terminal benchmark render [--json] [--frames N] [--input-events N] [--cols N] [--rows N]

Targets:
  terminal  Parser throughput, grid sync, scrollback search, and resize responsiveness.
  render    Headless WGPU renderer build, offscreen command submission, and input-to-GPU-complete latency."
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn terminal_benchmark_options_parse_and_clamp() {
        let parsed = parse_terminal_options(&args(&[
            "--json",
            "--lines",
            "999999",
            "--cols",
            "8",
            "--rows",
            "2",
            "--resize-iterations",
            "0",
        ]))
        .expect("options should parse");

        assert!(parsed.json);
        assert_eq!(parsed.lines, MAX_LINES);
        assert_eq!(parsed.cols, 20);
        assert_eq!(parsed.rows, 5);
        assert_eq!(parsed.resize_iterations, 1);
    }

    #[test]
    fn terminal_product_benchmark_report_covers_core_operations() {
        let options = TerminalBenchmarkOptions {
            json: false,
            lines: 32,
            cols: 40,
            rows: 8,
            resize_iterations: 2,
        };

        let report = run_terminal_benchmark(&options).expect("benchmark should run");

        assert_eq!(report.benchmark, "terminal_product_core");
        assert_eq!(report.lines, 32);
        assert!(report.bytes > 0);
        assert!(report.parse_ms >= 0.0);
        assert!(report.sync_ms >= 0.0);
        assert!(report.search_ms >= 0.0);
        assert_eq!(report.resize_iterations, 2);
        assert!(report.resize_total_ms >= 0.0);
        assert!(report.search_matches >= 1);
    }

    #[test]
    fn terminal_benchmark_json_output_is_machine_readable() {
        let output = run_benchmark_inner(&args(&[
            "terminal",
            "--json",
            "--lines",
            "16",
            "--resize-iterations",
            "1",
        ]))
        .expect("benchmark should run");
        let value: serde_json::Value = serde_json::from_str(&output).expect("valid json");

        assert_eq!(value["benchmark"], "terminal_product_core");
        assert_eq!(value["lines"], 16);
        assert!(value["parse_ms"].as_f64().is_some());
    }

    #[test]
    fn render_benchmark_options_parse_and_clamp() {
        let parsed = parse_render_options(&args(&[
            "--json",
            "--frames",
            "999999",
            "--input-events",
            "0",
            "--cols",
            "8",
            "--rows",
            "2",
        ]))
        .expect("options should parse");

        assert!(parsed.json);
        assert_eq!(parsed.frames, MAX_RENDER_FRAMES);
        assert_eq!(parsed.input_events, 1);
        assert_eq!(parsed.cols, 20);
        assert_eq!(parsed.rows, 5);
    }

    #[test]
    fn render_benchmark_report_names_wgpu_and_latency_scope() {
        let report = RenderBenchmarkReport {
            benchmark: "terminal_wgpu_render",
            version: "0.0.0-test",
            frames: 3,
            input_events: 2,
            cols: 80,
            rows: 24,
            cells: 80 * 24,
            texture_width: 800,
            texture_height: 480,
            adapter_name: "Test Adapter".to_string(),
            adapter_backend: "Metal".to_string(),
            adapter_device_type: "IntegratedGpu".to_string(),
            frame_build_total_ms: 6.0,
            frame_build_avg_ms: 2.0,
            gpu_submit_total_ms: 3.0,
            gpu_submit_avg_ms: 1.0,
            frame_total_ms: 9.0,
            frame_avg_ms: 3.0,
            input_to_gpu_total_ms: 8.0,
            input_to_gpu_avg_ms: 4.0,
        };

        let output = format_render_report(&report);

        assert!(output.contains("terminal_wgpu_render"));
        assert!(output.contains("adapter: Test Adapter"));
        assert!(output.contains("input to GPU complete"));
    }

    #[test]
    fn benchmark_usage_lists_render_target() {
        let output = run_benchmark_inner(&args(&["--help"])).expect("usage should render");

        assert!(output.contains("benchmark terminal"));
        assert!(output.contains("benchmark render"));
        assert!(output.contains("input-to-GPU-complete latency"));
    }
}
