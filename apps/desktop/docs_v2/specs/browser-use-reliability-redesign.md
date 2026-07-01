# Spec: Browser Use Reliability Redesign

## Scope

Make Tide Browser Use truthful before making it powerful.

The failure this fixes:

- The visible Browser Pane can be blank white.
- The backend can still report a new URL as loaded, or keep old DOM text.
- The agent then trusts stale state, acts too early, opens more panes, or switches to
  unrelated tools.

The near-term rule: if Tide cannot prove the pane is usable, the browser tool says so and
refuses to drive.

## Research Baseline

Primary sources reviewed:

- **MiniWoB++**: deterministic browser microtasks for click/type/scroll/form mechanics.
  <https://miniwob.farama.org/>
- **Mind2Web / Online-Mind2Web**: real-website traces with DOM, screenshots, and actions.
  <https://osu-nlp-group.github.io/Mind2Web/>
- **WebLINX**: multi-turn conversational web navigation across real sites.
  <https://mcgill-nlp.github.io/weblinx/>
- **WebArena**: reproducible self-hosted web workflows with end-to-end task success.
  <https://webarena.dev/>
- **VisualWebArena**: WebArena-style tasks where visual grounding matters.
  <https://github.com/web-arena-x/visualwebarena>
- **WorkArena / WorkArena++**: enterprise UI workflows.
  <https://servicenow.github.io/WorkArena/>
- **BrowserGym / AgentLab**: unified browser-agent observation/action benchmark wrapper.
  <https://github.com/ServiceNow/BrowserGym>
- **BEARCUBS**: live-web multimodal information-seeking tasks.
  <https://arxiv.org/abs/2503.07919>
- **SafeArena**: web-agent safety tasks.
  <https://safearena.github.io/>
- **TheAgentCompany**: broader workplace-agent benchmark using browser, terminal, code,
  and communication tools. <https://the-agent-company.com/>

Useful takeaways for Tide:

- MiniWoB-style local tasks should prove low-level input before real sites.
- VisualWebArena is the warning: DOM text and visible pixels can disagree.
- BrowserGym's shape is right: explicit observation, explicit action, explicit result.
- WebArena's metric is right: judge whether the user goal completed, not whether a click
  command returned.

## Minimal Runtime Contract

Do not introduce a large runtime negotiation layer yet. Each Browser Pane exposes only:

```ts
readiness: "loading" | "ready" | "blank" | "unavailable";

capabilities: {
  canReadDom: boolean;
  canCapturePixels: boolean;
  canActForeground: boolean;
  canActBackground: boolean;
};
```

Initial desktop-native capability claim:

```ts
{
  canReadDom: true,
  canCapturePixels: true,
  canActForeground: true,
  canActBackground: false
}
```

`canActBackground` stays false until a benchmark proves background action and background
pixel capture are reliable in the Tide runtime.

## State Rules

- Opening a URL starts as `loading`, not `ready`.
- Navigating an existing Browser Pane clears stale `pageTitle`, `bodyTextPreview`, and
  screenshot evidence.
- A renderer load snapshot with `loading:false` can move the pane to `ready`.
- `blank` is reserved for the next phase, after pixel statistics can detect near-empty
  screenshots.
- `unavailable` means the pane has no usable visual or DOM evidence yet.

## Action Rules

Before `tide_act_browser` schedules an action:

1. Check pane ownership and revision.
2. Refuse user-controlled panes.
3. Refuse concurrent pending actions unless the old pending action expired.
4. Refuse `loading` panes with a structured error telling the agent to re-observe.

This keeps the current async action model intact, but prevents the specific bad behavior:
acting on a just-opened or visually blank page.

Background driving policy:

- Current desktop-native runtime advertises `canActBackground:false`.
- Background action gating should be added only when the backend has a reliable
  foreground/background signal for panes.
- Until then, this capability is advisory in observe output and a benchmark target.

## Benchmark Plan

### Contract Tests

- New URL reports `readiness:"loading"`.
- Navigation clears stale DOM and screenshot evidence.
- Action while loading is rejected.
- Stale revision still returns `workbench_stale_reference`, not a loading error.
- Pending actions still reach terminal state through completion or watchdog expiry.

### Local Synthetic Tasks

Small local pages under test control:

- delayed SPA render
- blank-visible page with DOM text
- modal close
- autocomplete input
- date/time picker
- infinite scroll list
- DOM mutation without navigation

Metrics:

- `blank_as_ready`
- `stale_dom_after_navigation`
- `action_while_loading`
- `pending_action_timeout`
- `extra_pane_recovery`
- `time_to_ready`

### External Benchmarks

Order of adoption:

1. MiniWoB++ subset for basic mechanics.
2. VisualWebArena-style local fixtures for pixel/DOM disagreement.
3. BrowserGym wrapper for WebArena subsets after local tests are stable.
4. WorkArena later for enterprise-style workflows.
5. BEARCUBS-style live-web smoke tests, never as deterministic CI.
6. SafeArena-style checks once Browser Use can perform meaningful side effects.

## Roadmap

### Phase 1: Truthful State

- New URL starts `loading:true` and `readiness:"loading"`.
- Stale DOM/screenshot evidence is cleared on navigation.
- `tide_act_browser` refuses loading panes.
- Observe output includes the minimal capability claim.

### Phase 2: Pixel Blank Detection

- Add screenshot statistics.
- Mark near-empty screenshots as `blank`.
- If DOM text exists but pixels are blank, prefer `blank` over `ready`.

### Phase 3: Foreground/Background Gate

- Add a reliable pane foreground/background signal.
- Reject background actions while `canActBackground:false`.
- Only flip `canActBackground` after foreground/background benchmark parity passes.

### Phase 4: Better Actions

- Move from "queued pending" toward terminal action results where possible.
- Attach post-action observation evidence.
- Add bounded element candidates before introducing element-id actions.

## Acceptance Criteria

- A newly opened URL is never immediately reported as ready.
- The CatchTable-like blank SPA case returns `loading`, `blank`, or `unavailable`, never
  stale ready state.
- Action while loading is rejected with a structured error.
- Existing stale revision behavior is preserved.
- Background driving is not claimed until measured.
