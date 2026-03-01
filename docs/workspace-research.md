# Workspace Model Research

Tide UI를 재설계하기 위한 터미널 앱 워크스페이스/컨텍스트 관리 리서치.

핵심 질문: **터미널 앱의 경험을 유지하면서, 여러 프로젝트 컨텍스트를 정리하고 전환할 수 있는 모델은?**

---

## 현재 Tide 구조

```
Window → [FileTree | PaneArea (binary split tree) | EditorDock]
```

- 단일 워크스페이스. 하나의 레이아웃, 하나의 pane 집합
- 세션 복원은 있지만 하나의 세션만 대상
- 컨텍스트 전환 = pane 수동 닫기/열기 → 상태 유실
- 3영역 모델(FileTree/PaneArea/EditorDock)은 고정 구조

---

## 터미널 앱 스펙트럼

```
터미널 ◄──────────────────────────────────────────► IDE
Ghostty  Rio  Kitty  tmux  Zellij  iTerm2  WezTerm  Wave  Warp
                                      ↑
                                    Tide (현재)
```

---

## 접근법별 분석

### 1. "터미널만 잘 하자" — Ghostty, Rio

**모델:** Window > Tab > Split

- 레이아웃만 저장 (윈도우 위치, 탭 구조, split 방향)
- 세션/워크스페이스 개념 없음
- Ghostty: `window-save-state` 옵션 (layout only, scrollback 미보존)
- Rio: 세션 persistence 자체가 없음

**장점:** 깔끔함. 하나의 역할에 집중.
**단점:** 컨텍스트 전환 문제를 해결하지 않음. tmux/zellij에 위임.

**Tide 시사점:** Tide는 이미 이 단계를 넘어섰음 (파일 트리, 에디터 dock 등). 여기로 돌아가는 건 후퇴.

---

### 2. 세션 기반 멀티플렉서 — Zellij, tmux

**모델:** Session > Tab > Pane

터미널 안의 터미널. 세션이 곧 워크스페이스.

#### Zellij 주요 특징

- **Session Resurrection:** 매 1초마다 세션을 KDL 파일로 자동 직렬화 (`~/.cache/zellij/<session>.kdl`). 크래시/종료 후에도 `zellij attach <session>`으로 부활.
- **안전장치:** 부활된 세션의 명령어는 "Press ENTER to run..." 배너 뒤에 대기. 위험한 명령의 자동 실행 방지.
- **KDL 레이아웃 파일:** 선언적으로 탭/pane/명령어 정의 가능:
  ```kdl
  layout {
      tab name="code" {
          pane command="nvim" { cwd "/project"; }
          pane split_direction="vertical" {
              pane command="cargo" { args "watch"; }
              pane
          }
      }
      tab name="logs" {
          pane command="tail" { args "-f" "log.txt"; }
      }
  }
  ```
- **WASM 플러그인:** Welcome Screen, Session Manager, Filepicker 모두 WASM 플러그인으로 구현.
- **Floating/Stacked panes:** 일반 tiling 외에 floating pane과 stacked pane 지원.

#### tmux 비교

- 세션 persistence는 외부 플러그인 (tmux-resurrect, tmux-continuum)에 의존.
- prefix key 기반 인터랙션 (Ctrl-B). 학습 곡선 높음.
- Zellij는 모드 기반 + 화면에 키바인딩 표시로 접근성 높임.

**장점:** 세션 = 프로젝트라는 명확한 멘탈 모델. 즉시 전환. 상태 완전 보존.
**단점:** 터미널 앱 위에 얹는 레이어. Tide 같은 네이티브 GPU 렌더링 앱과 구조적 충돌.

**Tide 시사점:** Zellij의 자동 직렬화 + 부활 패턴은 참고할 만함. 하지만 Tide는 앱 자체가 멀티플렉서 역할을 하므로, 위에 다시 멀티플렉서를 얹는 건 부자연스러움.

---

### 3. 레이아웃 저장/복원 — iTerm2, Kitty

#### iTerm2: Window Arrangements + Profiles

**모델:** Window > Tab > Split Pane (+ Profiles, Arrangements 가 횡단 개념)

- **Profile:** 이름 붙은 설정 묶음 (색상, 폰트, 시작 명령어, working directory, 뱃지 등). 프로젝트별로 프로필 생성.
- **Window Arrangement:** 완전한 공간 상태 저장 — 윈도우 위치/크기, 탭 구조, split 배치, 각 pane의 프로필.
  - `Cmd+Shift+S`로 저장, `Cmd+Shift+R`로 복원.
  - 특정 arrangement에 키보드 단축키 할당 가능.
- **Dynamic Profiles:** JSON 파일로 프로필 정의 가능 → 버전 관리, 팀 공유.
- **Session Restore:** macOS 시스템 윈도우 복원 + "마지막 arrangement 자동 복원" 옵션.

**파워 유저 패턴:** 프로젝트별 Window Arrangement 생성 ("Frontend Dev", "Backend API"), 컨텍스트 전환 시 arrangement 전환.

#### Kitty: Session Files

**모델:** OS Window > Tab > Window (Pane)

- Plain text session 파일 (`.kitty-session`):
  ```
  layout tall
  cd ~/project
  launch nvim .
  launch zsh

  new_tab logs
  cd ~/project
  launch tail -f app.log
  ```
- `startup_session` 설정으로 자동 로드.
- `--relocatable` 플래그로 상대 경로 저장 → 이식성.
- 자동 저장/복원은 없음. 커뮤니티 도구 (kitty-save-session)로 보완.
- Kittens (Python 스크립트) + remote control API로 프로그래밍적 제어 가능.

**장점:** 선언적이고 버전 관리 가능. 직관적인 텍스트 포맷.
**단점:** 수동. 명시적 save/load 필요. "터미널스럽지 않은" 행동이 필요함.

**Tide 시사점:** 레이아웃 선언 파일은 참고 가능하나, "명시적 저장" 자체가 Tide가 원하는 방향과 충돌. 자동 persist가 필요.

---

### 4. 워크스페이스 내장 — WezTerm ★

**모델:** Workspace > MuxWindow > Tab > Pane

Tide와 가장 비슷한 위치의 터미널 앱이면서 워크스페이스를 내장한 유일한 사례.

#### 핵심 구조

- **Workspace = 문자열 라벨.** 윈도우와 탭이 워크스페이스에 소속.
- 워크스페이스 전환 시 관련 윈도우만 표시, 나머지는 숨김.
- `wezterm-mux-server`로 세션 persist — tmux 대체 가능.
- 새 워크스페이스는 키바인딩 하나로 생성 (이름 입력 프롬프트).

#### Lua 설정으로 프로그래밍적 워크스페이스

```lua
wezterm.on("gui-startup", function()
    local tab, pane, window = mux.spawn_window{ workspace = "coding" }
    pane:send_text("cd ~/project && nvim .\n")

    local tab2, pane2, window2 = mux.spawn_window{ workspace = "monitoring" }
    pane2:send_text("htop\n")

    mux.set_active_workspace("coding")
end)
```

#### Domain 추상화

- **Domain** = 연결 컨텍스트 (로컬, SSH, WSL, 원격 mux server)
- 하나의 워크스페이스 안에서 서로 다른 domain의 탭/pane 혼합 가능
- 원격 세션도 로컬처럼 관리

#### 워크스페이스 전환 UX

- `Cmd+Shift+S` → fuzzy finder로 워크스페이스 선택 → 즉시 전환
- 터미널 앱 안에서 일어남. GUI 오버헤드 최소.

**장점:**
- 터미널 앱의 정체성 유지 (GPU 렌더링, 네이티브 탭)
- 워크스페이스가 가볍고 즉시 전환 가능
- Lua 설정으로 무한히 커스터마이징 가능
- mux-server로 세션 완전 persist

**단점:**
- 워크스페이스 생성이 여전히 명시적 (이름 입력 필요)
- 자동 감지/자동 생성 없음

**Tide 시사점:** WezTerm의 "워크스페이스 = 라벨, 전환 = swap visibility" 모델이 Tide에 가장 적합. 단, 명시적 생성 대신 자동 persist를 결합하면 더 자연스러울 수 있음.

---

### 5. 블록 기반 대시보드 — Wave Terminal

**모델:** Window > Workspace > Tab > Block

#### 핵심 혁신: Block

- Block = 모듈형 컨텐츠 컨테이너. 터미널뿐 아니라 파일 프리뷰, 브라우저, AI 챗, 코드 에디터, 시스템 모니터 등.
- 각 block이 독립적으로 SSH 연결 가능 (한 탭에서 로컬 + remote 혼합).
- 블록끼리 tiling 레이아웃으로 배치 (binary tree 기반).
- Magnify: 블록 하나를 탭 전체로 확대/복원.

#### 워크스페이스 관리

- 기본적으로 임시 (ephemeral). 명시적으로 "Save workspace" 해야 영구 보존.
- Workspace Switcher: 아이콘, 컬러 커스터마이징 가능.
- 저장 대상: 탭 구조, 레이아웃, 터미널 scrollback, AI 대화, 에디터 상태.
- **Durable SSH sessions (v0.14.0):** 네트워크 끊김, sleep, 앱 재시작 후에도 SSH 세션 유지.

#### `wsh` CLI

- 터미널 안에서 Wave를 제어:
  ```
  wsh edit file.txt    # 에디터 블록 열기
  wsh web url          # 브라우저 블록 열기
  wsh ai "explain"     # AI 블록 열기
  ```
- SSH 원격 세션에서도 로컬 Wave 제어 가능.

**장점:** 최고 수준의 컨텍스트 보존 (scrollback, AI, 에디터까지). 유연한 블록 타입.
**단점:** 터미널 경험에서 멀어짐. Electron 기반이라 성능 한계. 명시적 save 필요.

**Tide 시사점:** Block 개념은 Tide의 PaneKind (Terminal, Editor, Diff, Browser)과 유사. `wsh` 같은 CLI 브릿지는 Phase 3 (Extensibility)에서 참고 가능. 단, 전체 모델을 따라가면 터미널 앱이 아니게 됨.

---

### 6. 에이전트 터미널 — Warp

**모델:** Window > Tab > Block (command-as-unit)

#### Blocks (명령어 단위)

- 전통 터미널의 스크롤백이 아닌, 각 명령어 실행을 개별 Block으로 분리.
- Prompt + Command Input + Output이 하나의 단위.
- 개별 block 검색, 필터, 복사, 공유 가능.
- 입력 영역이 코드 에디터처럼 동작 (multi-line, syntax highlight).

#### Warp 2.0 — Agentic Development Environment

- Code, Agents, Terminal, Drive 4개 영역 통합.
- AI 에이전트가 터미널 제어, 파일 읽기/쓰기, 디버깅 수행.
- `WARP.md`로 프로젝트 컨텍스트 정의.

**장점:** 명령어를 개별 단위로 다루는 게 혁신적.
**단점:** 전통 PTY 모델을 깨뜨림. 터미널이라기보다 AI 개발 환경. 프로프라이어터리.

**Tide 시사점:** Block 개념은 흥미롭지만 Tide의 방향과 다름. Tide는 전통 PTY 기반 (alacritty_terminal). 근본 구조가 다르므로 직접 적용 어려움.

---

## 비교 테이블

| 앱 | 계층 | 세션 Persist | 프로젝트 격리 | 자동 저장 | 터미널 느낌 |
|---|---|---|---|---|---|
| Ghostty | Window > Tab > Split | Layout only | 없음 | O (layout) | ★★★★★ |
| Rio | Window > Tab > Split | 없음 | 없음 | X | ★★★★★ |
| Kitty | OS Window > Tab > Window | Session 파일 (수동) | OS Window = project | X | ★★★★☆ |
| tmux | Session > Window > Pane | 플러그인 의존 | Session = project | X | ★★★★☆ |
| Zellij | Session > Tab > Pane | 1초 자동 직렬화 | Session = project | O | ★★★★☆ |
| iTerm2 | Window > Tab > Split | Arrangements (수동) | Arrangement = project | △ | ★★★★☆ |
| **WezTerm** | **Workspace > Window > Tab > Pane** | **Mux server** | **Workspace = project** | **O** | **★★★★☆** |
| Wave | Workspace > Tab > Block | Saved workspace (수동) | Workspace = project | X | ★★★☆☆ |
| Tabby | Window > Tab > Split | 플러그인 의존 | Profile Groups | X | ★★★☆☆ |
| Warp | Window > Tab > Block | Partial | WARP.md | △ | ★★☆☆☆ |

---

## 참고할 패턴 요약

### Zellij — 자동 직렬화 + 안전한 부활
- 매 1초 세션 상태를 파일로 직렬화
- 크래시 후 부활 시 명령어는 Enter 대기 (안전장치)
- 선언적 KDL 레이아웃 파일

### WezTerm — 터미널 앱 내 워크스페이스 ★
- Workspace = 문자열 라벨. 가볍고 빠른 전환.
- Fuzzy finder로 워크스페이스 선택.
- Lua 스크립트로 프로그래밍적 구성.
- Mux server로 세션 영속.

### iTerm2 — Window Arrangement
- 공간 상태의 스냅샷 저장/복원
- 프로필 시스템으로 pane별 설정 분리

### Wave — Durable SSH + CLI 브릿지
- SSH 세션이 네트워크 끊김/앱 재시작 후에도 유지
- `wsh` CLI로 터미널 안에서 GUI 제어

### Ghostty — Undo Close
- Split/Tab 닫기를 timeout 내에 undo 가능
- 작지만 의미 있는 UX 혁신

---

## Tide 적용 방향 (초안)

### 가장 유력한 모델: WezTerm식 워크스페이스 + Zellij식 자동 persist

```
Tide Workspace (label/directory)
├── FileTree state
├── PaneArea layout (binary split tree)
│   ├── Terminal panes (CWD, scrollback)
│   └── Editor/Diff/Browser panes
├── EditorDock state
└── Focus state, scroll positions, etc.
```

- **워크스페이스 = 라벨** (디렉토리 기반이든 이름 기반이든)
- **자동 persist** — Zellij처럼 주기적 직렬화. 명시적 save 없음.
- **전환 = swap visibility** — WezTerm처럼 관련 상태만 교체. 즉시.
- **Switcher = fuzzy finder** — `Cmd+Shift+S` 등으로 워크스페이스 목록 → 선택 → 전환.
- **터미널 앱 유지** — Tide를 열면 마지막 워크스페이스로 바로 시작. 별도 런처/매니저 없음.

### 미해결 질문

1. **워크스페이스 생성 트리거:** 디렉토리 기반 자동 생성 vs 명시적 생성 (이름 입력). 전자는 자연스럽지만 "cd와 workspace root 구분" 문제 발생. 후자는 한 단계 행동이 더 필요.
2. **워크스페이스 간 pane 이동:** 한 워크스페이스의 터미널을 다른 워크스페이스로 옮길 수 있어야 하나?
3. **멀티 윈도우 vs 싱글 윈도우:** 워크스페이스 전환이 같은 윈도우 안에서 일어나나, 윈도우별로 분리하나?
4. **터미널 프로세스 보존:** 워크스페이스 전환 시 background 터미널의 실행 중인 프로세스를 어떻게 처리?
5. **scrollback 보존:** 모든 워크스페이스의 scrollback을 메모리에 유지? 디스크로 swap?
