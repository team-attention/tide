# Spec: Naming Convention Cleanup

## Overview

### As-Is
흡수된 크레이트 내부 파일들이 옛날 크레이트 구조 그대로 남아있어서 네이밍 컨벤션에 안 맞음.

### To-Be
모든 파일이 역할 접미사 컨벤션을 따름.

### Convention
- `*_port.rs` — trait 정의 (application/ports/)
- `*_service.rs` — use case 구현 (application/services/)
- `*_adapter.rs` — port 구현체 (adapter/outward/)
- 폴더는 접미사 없이 도메인/기능 이름 사용

## Remaining Work

### 1. adapter/outward/renderer/ (10 files)
현재: atlas.rs, chrome.rs, font.rs, grid.rs, init.rs, mod.rs, msdf.rs, overlay.rs, shaders.rs, vertex.rs
- mod.rs의 WgpuRenderer가 Renderer trait(core_types.rs)을 구현 → adapter
- 내부 파일들은 WgpuRenderer의 private 구현 세부사항
- 방향: 파일 접미사는 불필요 (폴더 자체가 adapter). 그대로 유지 OK.

### 2. adapter/outward/platform_native/ (7 files)
현재: mod.rs, macos/app.rs, macos/ime_proxy.rs, macos/mod.rs, macos/view.rs, macos/webview.rs, macos/window.rs
- mod.rs가 PlatformEvent, WindowCommand 등 정의 + macos/ 하위에 구현
- 방향: 그대로 유지 OK (폴더 자체가 adapter).

### 3. adapter/outward/lsp_client/ (6 files)
현재: mod.rs, client.rs, install.rs, manager.rs, protocol.rs, transport.rs
- 방향: 그대로 유지 OK.

### 4. adapter/outward/view/ (15+ files)
현재: mod.rs, cursor.rs, grid.rs, header.rs, hover.rs, ime.rs, render_thread.rs, ui.rs, chrome/, overlays/
- 전부 impl App 메서드 (렌더링 로직)
- **문제**: 이것들은 adapter가 맞는가? impl App이면 application service 아닌가?
- 방향: 확인 필요. 순수 렌더링 출력이면 adapter(outward), App 상태 조작이면 service.

### 5. adapter/inward/handler/ (15+ files)
현재: event_loop.rs, drag_drop.rs, ime.rs, scroll.rs, search.rs, text_routing.rs, click/, keyboard/, mouse/
- 접미사 없음
- 방향: `*_handler.rs` 접미사? 또는 폴더 안이니까 불필요?

### 6. domain/ absorbed modules
현재: terminal/, editor/, layout/, input/, tree/ — 각각 옛날 크레이트 구조
- 이것들은 domain 엔티티/로직이라 접미사 불필요 (doctornow에서도 Doctor.kt, DoctorContact.kt)
- 방향: 그대로 유지 OK.

### 7. Ports struct 위치 (의존성 위반)
현재: application/ports/outward/mod.rs에 Ports struct + noop()/real()
- noop()/real()이 adapter의 Real/Noop을 import → application→adapter 의존성 위반
- 방향: Ports struct를 app.rs 또는 main.rs로 이동 (조립은 최상위에서)

### 8. gpu_port의 RenderThreadHandle 참조 (의존성 위반)
현재: application/ports/outward/gpu_port.rs가 rendering::render_thread::RenderThreadHandle 직접 참조
- 방향: trait에서 opaque type으로 추상화하거나, RenderThreadHandle을 application layer로 이동

## Priority
- #7, #8: 의존성 위반 → 먼저
- #4, #5: 컨벤션 정리 → 다음
- #1, #2, #3, #6: 이미 OK
