# Spec: Agent Auto-Integration

## Overview

### As-Is
Tide terminal 안에서 `claude`, `codex`, `gemini` 등 코딩 에이전트를 실행하면:
- MCP 서버를 수동으로 등록해야 에이전트가 Tide를 제어할 수 있다 (`enable-integration` CLI 명령 또는 유저가 직접 설정)
- 에이전트가 작업 완료/입력 대기 상태일 때 알림이 없어서 유저가 계속 해당 pane을 확인해야 한다
- `GatewayStatus`에서 에이전트 프로세스 감지(`detect_agent`)와 MCP 연결 상태 추적은 이미 구현되어 있으나, 에이전트의 lifecycle 상태(running/idle/needs-input)는 추적하지 않는다

### To-Be
Tide terminal에서 코딩 에이전트를 실행하면:
- MCP 서버가 자동으로 에이전트에 등록된다 (zero-config)
- Lifecycle hooks가 자동 주입되어 에이전트 상태가 Tide에 보고된다
- 에이전트가 유저 입력을 기다리거나 작업이 끝나면 시각적 알림이 표시된다

### Approach
1. Tide 앱 시작 시 `$TMPDIR/tide-<pid>-bin/`에 에이전트별 래퍼 스크립트 생성
2. Terminal PTY의 PATH에 래퍼 디렉토리를 prepend하여 `claude` 등 명령을 가로챔
3. 래퍼가 임시 settings JSON (MCP config + lifecycle hooks) 생성 후 원본 바이너리를 `exec`
4. Hooks가 `Tide notify <event>` CLI subcommand를 호출 → Agent Gateway로 상태 전파
5. `AgentInfo`에 `AgentStatus` 추가, 상태에 따라 tab에 시각적 indicator 표시

## Bounded Contexts
- **terminal** (`domain/terminal/`) — 래퍼 스크립트 생성, PATH injection in PTY env
- **gateway** (`adapter/inward/cli_adapter/`, `domain/state/gateway_status.rs`) — notify subcommand, AgentStatus tracking
- **renderer** (`adapter/outward/view/chrome/`) — 탭 상태 indicator rendering

## Use Cases

### UC-1: GenerateAgentWrappers
- **Actor**: Tide App (startup)
- **Trigger**: App 초기화 시 (Gateway socket 설정 직후)
- **Precondition**: Tide binary path resolvable via `std::env::current_exe()`
- **Flow**:
  1. `$TMPDIR/tide-<pid>-bin/` 디렉토리 생성
  2. 지원 에이전트별 (claude, codex, gemini) 래퍼 스크립트 생성
  3. 각 래퍼: 원본 바이너리 찾기 → 임시 settings JSON 생성 (MCP + hooks) → `exec` 원본
  4. 래퍼 디렉토리 경로를 `AGENT_WRAPPER_DIR` static에 저장
- **Postcondition**: 래퍼 스크립트가 실행 가능한 상태로 존재
- **Business Rules**:
  - BR-1: 래퍼는 PATH에서 자기 자신의 디렉토리를 제거한 후 원본 바이너리를 탐색해야 한다
  - BR-2: 원본 바이너리가 없으면 표준 "command not found" 메시지를 출력하고 exit 127
  - BR-3: 임시 settings 파일은 `trap ... EXIT`으로 프로세스 종료 시 정리
  - BR-4: 각 에이전트의 settings format에 맞게 MCP + hooks JSON 생성 (Claude: `--settings`, Codex/Gemini: 각자 포맷)

### UC-2: InjectWrapperPATH
- **Actor**: Terminal (PTY spawn)
- **Trigger**: 새 Terminal pane 생성 시
- **Precondition**: `AGENT_WRAPPER_DIR`이 설정되어 있음
- **Flow**:
  1. 기존 env 설정 (TERM, COLORTERM, TIDE_SOCKET 등) 수행
  2. `TIDE_BIN` 환경변수에 Tide 바이너리 경로 설정
  3. `PATH`에 래퍼 디렉토리를 prepend
- **Postcondition**: 해당 terminal에서 `claude` 입력 시 래퍼가 실행됨
- **Business Rules**:
  - BR-1: 래퍼 디렉토리가 PATH의 맨 앞에 위치해야 함 (원본보다 우선)
  - BR-2: `TIDE_BIN`은 `std::env::current_exe()` 결과를 사용

### UC-3: NotifyAgentStatus
- **Actor**: Agent lifecycle hook (외부 프로세스)
- **Trigger**: `Tide notify <event-type> --pane <id>` CLI 실행
- **Precondition**: `TIDE_SOCKET` 환경변수가 설정되어 있음
- **Flow**:
  1. args 파싱: event-type, pane id
  2. `TIDE_SOCKET`으로 Gateway 소켓에 연결
  3. JSON-RPC `notify` 메서드 전송: `{"event": "<type>", "pane": <id>}`
  4. 즉시 종료 (응답 대기 불필요)
- **Postcondition**: Gateway에 에이전트 상태 이벤트 전달됨
- **Business Rules**:
  - BR-1: 지원 이벤트: `agent-running`, `agent-idle`, `agent-needs-input`
  - BR-2: 소켓 연결 실패 시 silent exit (exit 0) — 에이전트 작업을 방해하지 않음
  - BR-3: fire-and-forget — 응답을 기다리지 않음

### UC-4: HandleAgentNotify
- **Actor**: Agent Gateway (App event loop)
- **Trigger**: `notify` CLI 커맨드 수신
- **Precondition**: pane_id가 유효한 terminal pane
- **Flow**:
  1. event type에 따라 AgentInfo의 status 업데이트
  2. `gateway_notify` 로 subscribers에 브로드캐스트
  3. chrome_generation bump → 탭 indicator 업데이트 트리거
- **Postcondition**: `AgentInfo.status`가 업데이트되고 UI에 반영됨
- **Business Rules**:
  - BR-1: `agent-running` → `AgentStatus::Running`
  - BR-2: `agent-idle` → `AgentStatus::Idle`
  - BR-3: `agent-needs-input` → `AgentStatus::NeedsInput`
  - BR-4: pane_id에 해당하는 detected_agent가 없으면 무시 (에러 아님)

### UC-5: RenderAgentStatusIndicator
- **Actor**: Renderer (view layer)
- **Trigger**: chrome_generation 변경 시 탭 렌더링
- **Precondition**: 해당 pane에 detected agent가 있고 status가 Idle이 아님
- **Flow**:
  1. 탭 타이틀 옆에 상태 dot 렌더링
  2. Running → 초록 dot, NeedsInput → 주황 dot, Idle → 없음
- **Postcondition**: 유저가 탭을 보고 에이전트 상태를 즉시 파악 가능
- **Business Rules**:
  - BR-1: dot은 탭 타이틀 왼쪽에 작은 원으로 표시
  - BR-2: NeedsInput 상태에서 해당 pane이 unfocused면 dot이 깜빡이거나 더 눈에 띄게 표시

## Invariants
1. 래퍼 스크립트는 원본 바이너리의 동작을 변경하지 않는다 (MCP/hooks 설정만 추가)
2. 래퍼 디렉토리 제거(PATH에서) 후 `command -v`로 찾은 바이너리가 원본임을 보장
3. `Tide notify` 실패가 에이전트 프로세스에 영향을 주지 않음 (non-blocking, exit 0)
4. 여러 Tide 인스턴스가 동시 실행돼도 PID 기반 디렉토리로 충돌 없음

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-4 | BR-1 | `notify_agent_running_updates_status()` |
| UC-4 | BR-2 | `notify_agent_idle_updates_status()` |
| UC-4 | BR-3 | `notify_agent_needs_input_updates_status()` |
| UC-4 | BR-4 | `notify_ignores_unknown_pane()` |
| UC-3 | BR-1 | `notify_rejects_unknown_event_type()` |
| UC-4 | — | `notify_requires_event_param()` |
| UC-4 | — | `notify_requires_pane_param()` |
| UC-4 | — | `notify_bumps_chrome_generation()` |
| UC-4 | — | `notify_does_not_bump_chrome_when_no_agent()` |
| UC-1 | — | `wrapper_scripts_are_generated_at_known_path()` |

## Location

| Module | Path | Change |
|--------|------|--------|
| terminal | `domain/terminal/mod.rs` | `AGENT_WRAPPER_DIR`, `generate_agent_wrappers()`, PATH injection |
| main | `main.rs` | `notify` subcommand routing |
| cli_adapter | `adapter/inward/cli_adapter/notify.rs` | **NEW** — notify CLI client |
| cli_adapter | `adapter/inward/cli_adapter/mod.rs` | register notify module |
| cli_adapter | `adapter/inward/cli_adapter/commands.rs` | `notify` command handler |
| gateway_status | `domain/state/gateway_status.rs` | `AgentStatus` enum, extend `AgentInfo` |
| titlebar | `adapter/outward/view/chrome/titlebar.rs` | agent status dot rendering |
