# Spec: Agent Context Injection

## Overview

### As-Is
Tide terminal에서 코딩 에이전트(Claude Code, Codex, Gemini)를 실행할 때:
- 에이전트는 자신이 실행 중인 terminal pane의 내용만 인지한다
- 유저가 editor pane에서 작업 중인 파일 내용을 에이전트에게 전달하려면 직접 복사-붙여넣기하거나, 에이전트에게 MCP 도구를 호출하라고 명시적으로 요청해야 한다
- MCP 서버(`tide_capture_pane`, `tide_list_panes`)가 이미 존재하지만, 에이전트가 자발적으로 호출하지 않으면 컨텍스트가 전달되지 않는다
- Cursor, Dia browser 같은 도구는 에이전트가 편집 중인 파일을 자동으로 인지하지만, Tide에서는 이 경험이 없다

### To-Be
Tide terminal에서 코딩 에이전트를 실행하면:
- 에이전트가 **매 프롬프트마다 자동으로** 같은 workspace의 editor pane 내용을 컨텍스트로 받는다 (Ambient Context)
- 유저가 editor pane에서 텍스트를 선택하고 `Cmd+L`을 누르면 해당 selection이 에이전트 terminal pane에 **시각적 chip**으로 표시되고, 다음 프롬프트 전송 시 자동으로 포함된다 (Pinned Context)
- 각 에이전트의 hook 시스템 차이는 wrapper 레이어에서 흡수하고, domain 로직은 에이전트에 무관하다

### Approach
1. Domain에 `AgentContext` 타입 추가 — 에이전트에 전달할 컨텍스트의 순수 데이터 모델
2. Gateway command `context` 추가 — 요청한 pane의 sibling editor pane 컨텍스트를 수집
3. CLI subcommand `tide context` 추가 — wrapper hook에서 호출, `--format` 플래그로 에이전트별 출력 포맷 결정
4. Wrapper 스크립트 업데이트 — 기존 hook에 `tide context` 호출 추가
5. `PinnedContext` 도메인 모델 + `Cmd+L` GlobalAction 추가 — 명시적 selection pinning
6. Terminal pane에 pinned context chip overlay 렌더링

## Bounded Contexts
- **terminal** (`domain/terminal/`) — wrapper 스크립트 업데이트 (hook에 context 호출 추가)
- **pane** (`domain/pane/`) — `PinnedContext` 상태 저장 (TerminalPane에 추가)
- **gateway** (`adapter/inward/cli_adapter/`) — `context` gateway command, `tide context` CLI subcommand
- **input** (`domain/input/`) — `PinSelectionToAgent` GlobalAction
- **renderer** (`adapter/outward/view/`) — pinned context chip overlay 렌더링

## Use Cases

### UC-1: GatherWorkspaceContext
- **Actor**: Agent hook (외부 프로세스, wrapper를 통해 실행)
- **Trigger**: `tide context --pane <id> --format <agent>` CLI 실행
- **Precondition**: `TIDE_SOCKET` 환경변수 설정됨, 대상 pane이 유효한 terminal pane
- **Flow**:
  1. CLI가 Gateway 소켓에 연결, `context` method 호출 (`{"pane": <id>, "format": "<agent>"}`)
  2. Gateway command handler가 요청 pane의 workspace에서 모든 editor pane을 탐색
  3. 각 editor pane에서 `EditorContext` 수집: file_path, content (size cap 적용), cursor position, selection range, dirty 상태
  4. 해당 terminal pane에 `PinnedContext`가 있으면 함께 포함
  5. `--format` 에 따라 에이전트별 출력 포맷으로 변환하여 stdout에 출력
- **Postcondition**: 에이전트가 인지할 수 있는 형태로 컨텍스트가 stdout에 출력됨
- **Business Rules**:
  - BR-1: editor pane content는 최대 500줄까지만 포함 (초과 시 cursor 주변 ±250줄)
  - BR-2: format별 출력:
    - `claude`: `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}`
    - `codex`: plain text (stdout 자체가 context로 처리됨)
    - `gemini`: `{"additionalContext":"..."}`
    - `raw` (기본값): JSON `{"editors":[...],"pinned":null}`
  - BR-3: editor pane이 없고 pinned context도 없으면 빈 출력 (exit 0, stdout 없음)
  - BR-4: Gateway 소켓 연결 실패 시 silent exit (exit 0) — 에이전트 작업을 방해하지 않음
  - BR-5: content에 에이전트 format의 구분자(delimiter)가 포함된 경우 escape 처리

### UC-2: InjectContextViaHook
- **Actor**: Wrapper 스크립트 (claude, codex, gemini)
- **Trigger**: 에이전트의 prompt submit hook 발생 (Claude: `UserPromptSubmit`, Codex: `UserPromptSubmit`, Gemini: `BeforeAgent`)
- **Precondition**: Tide 안에서 에이전트가 실행 중 (`TIDE_BIN`, `TIDE_PANE` 설정됨)
- **Flow**:
  1. 기존 hook 동작 수행 (status notification: `tide notify agent-running`)
  2. `$TIDE_BIN context --pane $TIDE_PANE --format <agent>` 실행
  3. `tide context`의 stdout을 hook의 stdout으로 전달
  4. 에이전트가 hook stdout을 컨텍스트로 처리
- **Postcondition**: 에이전트가 현재 workspace의 editor 내용을 자동으로 인지
- **Business Rules**:
  - BR-1: Claude wrapper — `UserPromptSubmit` hook의 command를 복합 스크립트로 변경. `tide notify`와 `tide context` 순차 실행. `tide context --format claude`의 stdout이 hook의 최종 stdout이 된다
  - BR-2: Codex wrapper — `hooks.json` 파일 생성하여 `-c` 플래그 또는 config로 주입. `UserPromptSubmit` hook에서 `tide context --format codex` 실행
  - BR-3: Gemini wrapper — `BeforeAgent` hook에 `tide context --format gemini` 추가. 기존 `tide notify agent-running`과 별도 hook entry로 등록 (hooks 배열에 추가)
  - BR-4: `tide context` 실패 시 (timeout, socket 오류 등) hook은 여전히 exit 0 반환 — 에이전트 정상 작동 보장
  - BR-5: hook timeout 내에서 실행 완료되어야 함. `tide context`의 타임아웃은 3초

### UC-3: PinSelectionToAgent
- **Actor**: User
- **Trigger**: editor pane에서 텍스트 선택 후 `Cmd+L` 입력
- **Precondition**: FocusArea가 Stage 또는 Dock이고, focused pane이 Editor이며, selection이 존재
- **Flow**:
  1. `Cmd+L` → GlobalAction `PinSelectionToAgent` 발생
  2. focused editor pane에서 selection 텍스트, file_path, line range 추출
  3. 해당 editor pane의 associated terminal (또는 workspace의 가장 최근 agent terminal) 탐색
  4. target terminal pane에 `PinnedContext` 저장: `{source_file, line_range, content, source_pane_id}`
  5. chrome_generation bump → chip overlay 렌더링 트리거
  6. focus를 target terminal pane으로 이동
- **Postcondition**: terminal pane에 pinned context chip이 표시되고, 다음 `tide context` 호출 시 포함됨
- **Business Rules**:
  - BR-1: selection이 없으면 editor 전체 내용을 pin (file context)
  - BR-2: 이미 pinned context가 있으면 교체 (1개만 유지, 단순성 우선)
  - BR-3: agent terminal이 없으면 (workspace에 에이전트가 실행 중인 terminal이 없으면) 동작하지 않음 (무시, 에러 아님)
  - BR-4: pinned content는 최대 200줄로 제한. 초과 시 selection의 처음/끝 각 100줄 + 중간 생략 표시

### UC-4: RenderPinnedContextChip
- **Actor**: Renderer (view layer)
- **Trigger**: terminal pane에 `PinnedContext`가 존재하고 chrome_generation 변경
- **Precondition**: 해당 terminal pane이 화면에 보이는 상태
- **Flow**:
  1. terminal pane의 `PinnedContext` 존재 여부 확인
  2. pane의 상단에 chip bar 렌더링: `📄 {filename}:{start}-{end}  ✕`
  3. filename은 경로의 마지막 2 segment (예: `life/on-my-mind.md`)
  4. `✕` 영역은 클릭 시 pinned context 제거
- **Postcondition**: 유저가 pinned context를 시각적으로 확인 가능
- **Business Rules**:
  - BR-1: chip은 terminal pane 콘텐츠 영역 상단에 1줄 높이로 렌더링 (terminal grid를 1줄 아래로 밀기)
  - BR-2: chip 배경색은 theme의 surface variant, 텍스트는 secondary color
  - BR-3: `Esc` 키가 terminal에 focus된 상태에서 눌리면 pinned context 제거 (modal dismiss와 동일 패턴)
  - BR-4: workspace 전환 시 pinned context는 terminal pane에 귀속되므로 자연스럽게 전환됨

### UC-5: ClearPinnedContext
- **Actor**: User 또는 System
- **Trigger**: chip의 ✕ 클릭, `Esc` 키, 또는 hook이 context를 소비한 후
- **Precondition**: terminal pane에 `PinnedContext`가 존재
- **Flow**:
  1. terminal pane의 `PinnedContext`를 `None`으로 설정
  2. chrome_generation bump
- **Postcondition**: chip이 사라지고 다음 `tide context` 호출에 pinned context가 포함되지 않음
- **Business Rules**:
  - BR-1: hook에 의해 context가 전달된 후에는 자동으로 clear하지 않음 (유저가 같은 context로 여러 번 질문할 수 있음)
  - BR-2: source editor pane이 닫히면 pinned context도 자동 clear

### UC-6: ExposeContextViaMcpTool
- **Actor**: AI agent (MCP tool call)
- **Trigger**: 에이전트가 `tide_get_context` MCP 도구 호출
- **Precondition**: MCP bridge가 연결된 상태
- **Flow**:
  1. MCP bridge가 `get-context` gateway command로 변환
  2. UC-1과 동일한 `ContextPort::workspace_context()` 로직 실행
  3. `raw` format으로 JSON 반환
- **Postcondition**: 에이전트가 명시적으로 컨텍스트를 조회 가능
- **Business Rules**:
  - BR-1: `tide_get_context`는 `pane_id` 파라미터 선택적 (기본값: MCP bridge의 TIDE_PANE)
  - BR-2: 반환 format은 항상 structured JSON (`raw` format)
  - BR-3: MCP tool description에 "Call this to see what the user is currently editing in other panes" 포함 — 에이전트가 자발적으로 호출하도록 유도

## Invariants
1. `tide context` 실패가 에이전트 프로세스에 영향을 주지 않는다 (silent failure, exit 0)
2. Context 수집은 read-only — editor pane 상태를 변경하지 않는다
3. PinnedContext는 반드시 유효한 terminal pane에만 저장된다 (PaneId sync invariant 준수)
4. Wrapper hook은 agent-specific format만 담당하고, context 수집 로직은 gateway에서 단일 구현
5. Hook의 timeout(3초) 내에 context 수집이 완료되어야 한다 — editor content가 아무리 커도 size cap(500줄)으로 보장

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `context_caps_editor_content_at_500_lines()` |
| UC-1 | BR-1 | `context_centers_on_cursor_when_capped()` |
| UC-1 | BR-2 | `context_formats_claude_json()` |
| UC-1 | BR-2 | `context_formats_codex_plain_text()` |
| UC-1 | BR-2 | `context_formats_gemini_json()` |
| UC-1 | BR-2 | `context_formats_raw_json()` |
| UC-1 | BR-3 | `context_returns_empty_when_no_editors()` |
| UC-1 | BR-5 | `context_escapes_delimiter_in_content()` |
| UC-3 | BR-1 | `pin_without_selection_pins_entire_file()` |
| UC-3 | BR-2 | `pin_replaces_existing_pinned_context()` |
| UC-3 | BR-3 | `pin_ignored_when_no_agent_terminal()` |
| UC-3 | BR-4 | `pin_caps_content_at_200_lines()` |
| UC-1 | — | `context_includes_pinned_context()` |
| UC-1 | — | `context_excludes_cleared_pinned_context()` |
| UC-5 | BR-2 | `pinned_context_cleared_when_source_editor_closes()` |
| UC-6 | BR-1 | `mcp_get_context_defaults_to_own_pane()` |
| UC-6 | BR-2 | `mcp_get_context_returns_raw_json()` |

## Location

| Module | Path | Change |
|--------|------|--------|
| pane | `domain/pane/mod.rs` | `PinnedContext` struct 추가, `TerminalPane`에 `pinned_context: Option<PinnedContext>` 필드 |
| input | `domain/input/mod.rs` | `PinSelectionToAgent` GlobalAction variant 추가 |
| cli_adapter | `adapter/inward/cli_adapter/context.rs` | **NEW** — `tide context` CLI subcommand (gateway 소켓 연결 + stdout 출력) |
| cli_adapter | `adapter/inward/cli_adapter/commands.rs` | `cli_context()` gateway command handler, `cli_get_context()` MCP용 |
| cli_adapter | `adapter/inward/cli_adapter/mcp.rs` | `tide_get_context` MCP tool 등록 |
| cli_adapter | `adapter/inward/cli_adapter/mod.rs` | context module 등록 |
| main | `main.rs` | `context` subcommand routing |
| terminal | `domain/terminal/mod.rs` | — (wrapper 스크립트는 resources/bin/에서 별도 관리) |
| resources | `resources/bin/claude` | hook에 `tide context --format claude` 추가 |
| resources | `resources/bin/codex` | hooks.json 생성 + `tide context --format codex` hook 추가 |
| resources | `resources/bin/gemini` | `BeforeAgent` hook에 `tide context --format gemini` 추가 |
| view | `adapter/outward/view/pane_chrome.rs` | pinned context chip 렌더링 |
| action handler | `application/services/action_service/` | `PinSelectionToAgent` 처리 로직 |
| glossary | `docs/glossary.md` | `AgentContext`, `PinnedContext`, `EditorContext` 용어 추가 |
