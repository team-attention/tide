# Spec: Structure Reorganization

## Overview

### As-Is
`adapter/outward/`에 단일 파일(`*_adapter.rs`)과 폴더(`renderer/`, `platform_native/`, `lsp_client/`)가 혼재.
일부 단일 파일은 폴더에 위임만 하는 thin wrapper. 폴더를 열었을 때 뭐가 있을지 예측 불가.

```
adapter/outward/
  clipboard_adapter.rs          ← 단일 파일
  clock_adapter.rs              ← 단일 파일
  fs_adapter.rs                 ← 단일 파일
  git_adapter.rs                ← 단일 파일
  gpu_adapter.rs                ← thin wrapper → renderer/ 위임
  lsp_adapter.rs                ← thin wrapper → lsp_client/ 위임
  persistence_adapter.rs        ← 단일 파일
  platform_adapter.rs           ← thin wrapper → platform_native/ 위임
  process_adapter.rs            ← 단일 파일
  terminal_factory_adapter.rs   ← 단일 파일
  file_watcher_adapter.rs       ← 단일 파일
  renderer/                     ← 폴더 (10 files)
  platform_native/              ← 폴더 (7 files)
  lsp_client/                   ← 폴더 (6 files)
  view/                         ← 폴더 (15+ files)
```

### To-Be
**폴더 이름에 역할 접미사**. `adapter/outward/`를 열면 `*_adapter/` 폴더만 보인다.
thin wrapper를 폴더에 합치고, 단일 파일도 `*_adapter/mod.rs`로 승격.

```
adapter/outward/
  clipboard_adapter/mod.rs
  clock_adapter/mod.rs
  file_watcher_adapter/mod.rs
  fs_adapter/mod.rs
  git_adapter/mod.rs
  lsp_adapter/mod.rs + client.rs, transport.rs, ...
  persistence_adapter/mod.rs
  platform_adapter/mod.rs + macos/...
  process_adapter/mod.rs
  renderer_adapter/mod.rs + atlas.rs, font.rs, ...
  terminal_factory_adapter/mod.rs
  view/                         ← 별도 논의 (이 스펙 범위 밖)
```

### 원칙
- **리프 바로 위 폴더 이름에 역할 접미사**: 폴더 이름이 그 안의 파일들이 뭔지 말해줌
- **같은 레이어의 내용물 형태가 일관**: `adapter/outward/` 열면 `*_adapter/` 폴더만
- thin wrapper와 실제 구현체 사이의 불필요한 indirection 제거

## Work Items

### WI-1. 단일 파일 어댑터를 `*_adapter/` 폴더로 승격

| 현재 | 이동 후 |
|------|---------|
| `clipboard_adapter.rs` | `clipboard_adapter/mod.rs` |
| `clock_adapter.rs` | `clock_adapter/mod.rs` |
| `fs_adapter.rs` | `fs_adapter/mod.rs` |
| `git_adapter.rs` | `git_adapter/mod.rs` |
| `process_adapter.rs` | `process_adapter/mod.rs` |
| `persistence_adapter.rs` | `persistence_adapter/mod.rs` |
| `terminal_factory_adapter.rs` | `terminal_factory_adapter/mod.rs` |
| `file_watcher_adapter.rs` | `file_watcher_adapter/mod.rs` |

파일 내용 변경 없음. 폴더 생성 + `mod.rs`로 이동만.

### WI-2. thin wrapper를 폴더에 합치고 `*_adapter/`로 rename

**gpu_adapter.rs + renderer/ → renderer_adapter/**

- `renderer/` → `renderer_adapter/`로 rename
- `gpu_adapter.rs`의 `RealGpu`/`NoopGpu` + `GpuPort` impl을 `renderer_adapter/mod.rs`에 합침
- device, queue, surface_config, render_thread 등 GPU 상태가 renderer_adapter 내부로 이동
- `gpu_adapter.rs` 삭제

**lsp_adapter.rs + lsp_client/ → lsp_adapter/**

- `lsp_client/` → `lsp_adapter/`로 rename
- `lsp_adapter.rs`의 `RealLsp`/`NoopLsp` + `LspPort` impl을 `lsp_adapter/mod.rs`에 합침
- `lsp_adapter.rs` 삭제

**platform_adapter.rs + platform_native/ → platform_adapter/**

- `platform_native/` → `platform_adapter/`로 rename
- `platform_adapter.rs`의 `RealPlatform`/`NoopPlatform` + `PlatformPort` impl을 `platform_adapter/mod.rs`에 합침
- `platform_adapter.rs` 삭제

### WI-3. Ports struct 이동 (의존성 위반 해소)

**현재**: `application/ports/outward/mod.rs`에 `Ports` struct + `noop()`/`real()`.
adapter의 `Real*`/`Noop*` 구현체를 직접 import → **application→adapter 의존 위반**.

**변경**:
- `Ports` struct, `noop()`, `real()` → `app.rs`로 이동
- `application/ports/outward/mod.rs`에는 trait re-export만 남김
- adapter import가 `app.rs`에서 일어나므로 application→adapter 의존 사라짐

### WI-4. gpu_port의 RenderThreadHandle 참조 제거 (의존성 위반 해소)

**현재**: `application/ports/outward/gpu_port.rs`가 `RenderThreadHandle` 참조.
port trait이 adapter concrete type에 의존 → **위반**.

**변경**:
- `GpuPort` trait에서 `render_thread()`, `set_render_thread()` 제거
- render thread 관리를 `renderer_adapter/` 내부로 캡슐화
- GpuPort에 `dispatch_frame()` / `poll_result()` 같은 추상 인터페이스 추가

### WI-5. main.rs alias 업데이트

```rust
// 변경 전
pub(crate) use adapter::outward::renderer as tide_renderer;
pub(crate) use adapter::outward::platform_native as tide_platform;
pub(crate) use adapter::outward::lsp_client as tide_lsp;

// 변경 후
pub(crate) use adapter::outward::renderer_adapter as tide_renderer;
pub(crate) use adapter::outward::platform_adapter as tide_platform;
pub(crate) use adapter::outward::lsp_adapter as tide_lsp;
```

`adapter/outward/mod.rs` 모듈 선언 업데이트:
```rust
pub(crate) mod clipboard_adapter;
pub(crate) mod clock_adapter;
pub(crate) mod file_watcher_adapter;
pub(crate) mod fs_adapter;
pub(crate) mod git_adapter;
pub(crate) mod lsp_adapter;
pub(crate) mod persistence_adapter;
pub(crate) mod platform_adapter;
pub(crate) mod process_adapter;
pub(crate) mod renderer_adapter;
pub(crate) mod terminal_factory_adapter;
pub(crate) mod view; // 별도 스펙
```

## Execution Order

```
WI-1 (단일 파일 → *_adapter/ 폴더 승격)
  → WI-2 (thin wrapper 합치기 + 폴더 rename)
  → WI-3 (Ports struct 이동)
  → WI-4 (gpu_port 의존성 제거)
  → WI-5 (alias 정리)
```

## Invariants

1. `adapter/outward/`에는 `*_adapter/` 폴더만 존재한다 (`view/` 제외, 별도 스펙).
2. 각 `*_adapter/` 폴더가 하나의 outward port 구현체이다.
3. `application/` 파일은 `adapter/` 타입을 직접 import하지 않는다.
4. 폴더 이름의 접미사가 그 안의 파일들의 역할을 나타낸다.

### WI-6. application/services/ 파일을 `*_service/` 폴더로 승격

naming convention 원칙 적용: `application/services/` 열면 `*_service/` 폴더만.

| 현재 | 이동 후 |
|------|---------|
| `action_service.rs` | `action_service/mod.rs` |
| `dock_service.rs` | `dock_service/mod.rs` |
| `file_ops_service.rs` | `file_ops_service/mod.rs` |
| `file_tree_service.rs` | `file_tree_service/mod.rs` |
| `focus_nav_service.rs` | `focus_nav_service/mod.rs` |
| `gpu_init_service.rs` | `gpu_init_service/mod.rs` |
| `lsp_service.rs` | `lsp_service/mod.rs` |
| `pane_close_service.rs` | `pane_close_service/mod.rs` |
| `pane_create_service.rs` | `pane_create_service/mod.rs` |
| `search_service.rs` | `search_service/mod.rs` |
| `session_service.rs` | `session_service/mod.rs` |
| `text_extract_service.rs` | `text_extract_service/mod.rs` |
| `update_service.rs` | `update_service/mod.rs` |
| `workspace_service.rs` | `workspace_service/mod.rs` |
| `workspace_infra_service.rs` | `workspace_infra_service/mod.rs` |

파일 내용 변경 없음. 폴더 생성 + `mod.rs`로 이동만.

## Execution Order

```
WI-1 (단일 파일 adapter → *_adapter/ 폴더 승격)
  → WI-2 (thin wrapper 합치기 + 폴더 rename)
  → WI-3 (Ports struct 이동)
  → WI-4 (gpu_port 의존성 제거)
  → WI-5 (alias 정리)
  → WI-6 (services → *_service/ 폴더 승격)
```

## Invariants

1. `adapter/outward/`에는 `*_adapter/` 폴더만 존재한다 (`view/` 제외, 별도 스펙).
2. `application/services/`에는 `*_service/` 폴더만 존재한다.
3. 각 `*_adapter/` 폴더가 하나의 outward port 구현체이다.
4. `application/` 파일은 `adapter/` 타입을 직접 import하지 않는다.
5. 폴더 이름의 접미사가 그 안의 파일들의 역할을 나타낸다.

## Scope 밖

- `view/` 위치 결정 — 별도 스펙
- `adapter/inward/` 구조 — 별도 스펙
