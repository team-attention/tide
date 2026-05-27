#!/usr/bin/env python3
from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import fcntl
import json
import os
import pathlib
import re
import select
import shlex
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
import tty
from typing import Any


ANSI_RE = re.compile(
    rb"\x1b\[[0-?]*[ -/]*[@-~]"
    rb"|\x1b\][^\x07]*(?:\x07|\x1b\\)"
    rb"|\x1b[@-_]"
)

KEY_BYTES = {
    "enter": b"\r",
    "csi-u-enter": b"\x1b[13u",
    "none": b"",
    "esc": b"\x1b",
    "ctrl-c": b"\x03",
    "up": b"\x1b[A",
    "down": b"\x1b[B",
    "right": b"\x1b[C",
    "left": b"\x1b[D",
    "tab": b"\t",
    "space": b" ",
}

DEFAULT_CODEX_PERMISSION_PROMPT = (
    "Run this shell command and report the output exactly: "
    "python3 -c 'print(\"CODEX_PERMISSION_FIXTURE\")'"
)
DEFAULT_CLAUDE_PERMISSION_PROMPT = (
    "Run this shell command and report the output exactly: "
    "python3 -c 'print(\"CLAUDE_PERMISSION_FIXTURE\")'"
)


@dataclasses.dataclass(frozen=True)
class AgentDefaults:
    command: list[str]
    submit: str
    state_roots: list[str]


AGENTS: dict[str, AgentDefaults] = {
    "codex": AgentDefaults(
        command=["codex", "--no-alt-screen"],
        submit="enter",
        state_roots=["~/.codex/sessions", "~/.codex/config.toml", "~/.codex/history.jsonl"],
    ),
    "claude": AgentDefaults(
        command=["claude"],
        submit="csi-u-enter",
        state_roots=["~/.claude/projects", "~/.claude.json"],
    ),
    "agy": AgentDefaults(
        command=["agy"],
        submit="enter",
        state_roots=["~/.gemini/antigravity-cli"],
    ),
    "custom": AgentDefaults(command=[], submit="enter", state_roots=[]),
}


def resolve_resume_command(args: argparse.Namespace) -> list[str]:
    if not args.resume_ref:
        raise SystemExit("--scenario resume requires --resume-ref")
    if args.agent == "codex":
        return ["codex", "resume", "--no-alt-screen", args.resume_ref]
    if args.agent == "claude":
        return ["claude", "--resume", args.resume_ref]
    if args.agent == "agy":
        return ["agy", "--conversation", args.resume_ref]
    raise SystemExit("--agent custom with --scenario resume requires --command")


def resolve_permission_command(args: argparse.Namespace) -> list[str]:
    if args.command:
        raise SystemExit("--scenario permission uses provider defaults and does not support --command")
    if args.agent == "codex":
        return [
            "codex",
            "-c",
            "features.hooks=true",
            "-c",
            "bypass_hook_trust=true",
            "--dangerously-bypass-hook-trust",
            "--ask-for-approval",
            "untrusted",
            "--no-alt-screen",
        ]
    if args.agent == "claude":
        return ["claude"]
    raise SystemExit("--scenario permission currently supports --agent codex or claude")


def now_stamp() -> str:
    return dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def iso_from_ns(ns: int) -> str:
    return dt.datetime.fromtimestamp(ns / 1_000_000_000).isoformat()


def parse_env(values: list[str]) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise SystemExit(f"--env must be KEY=VALUE, got: {value}")
        key, env_value = value.split("=", 1)
        if not key:
            raise SystemExit(f"--env key cannot be empty: {value}")
        parsed[key] = env_value
    return parsed


def resolve_command(args: argparse.Namespace) -> list[str]:
    if args.scenario == "permission":
        return resolve_permission_command(args)
    if args.command:
        return [args.command, *args.arg]
    if args.scenario == "resume":
        return resolve_resume_command(args)
    defaults = AGENTS[args.agent]
    if not defaults.command:
        raise SystemExit("--agent custom requires --command")
    return list(defaults.command)


def resolve_state_roots(args: argparse.Namespace) -> list[pathlib.Path]:
    roots = args.state_root if args.state_root else AGENTS[args.agent].state_roots
    return [pathlib.Path(root).expanduser() for root in roots]


def require_command_available(command: list[str]) -> None:
    exe = command[0]
    if os.path.isabs(exe) or "/" in exe:
        if not os.path.exists(exe):
            raise SystemExit(f"Command not found: {exe}")
        return
    if shutil.which(exe) is None:
        raise SystemExit(f"Command not found on PATH: {exe}")


def file_record(path: pathlib.Path) -> dict[str, Any] | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return {
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "mtime": iso_from_ns(stat.st_mtime_ns),
    }


def snapshot_state(
    roots: list[pathlib.Path],
    max_files: int,
    max_dirs: int,
) -> dict[str, Any]:
    files: dict[str, dict[str, Any]] = {}
    root_records: list[dict[str, Any]] = []
    warnings: list[str] = []
    dirs_seen = 0
    files_seen = 0
    stopped = False

    for root in roots:
        root_info = {
            "path": str(root),
            "exists": root.exists(),
            "is_file": root.is_file(),
            "is_dir": root.is_dir(),
        }
        root_records.append(root_info)

        if stopped or not root.exists():
            continue

        if root.is_file():
            record = file_record(root)
            if record is not None:
                files[str(root)] = record
                files_seen += 1
            continue

        if not root.is_dir():
            continue

        for dirpath, dirnames, filenames in os.walk(root):
            dirs_seen += 1
            if dirs_seen > max_dirs:
                warnings.append(f"directory scan capped at {max_dirs} directories")
                stopped = True
                break

            dirnames.sort()
            filenames.sort()

            for filename in filenames:
                if files_seen >= max_files:
                    warnings.append(f"file scan capped at {max_files} files")
                    stopped = True
                    break
                path = pathlib.Path(dirpath) / filename
                record = file_record(path)
                if record is not None:
                    files[str(path)] = record
                    files_seen += 1

            if stopped:
                break

        if stopped:
            break

    return {
        "roots": root_records,
        "files": files,
        "counts": {
            "files": len(files),
            "dirs_seen": dirs_seen,
            "files_seen": files_seen,
        },
        "warnings": warnings,
    }


def diff_state(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    before_files = before.get("files", {})
    after_files = after.get("files", {})
    before_paths = set(before_files.keys())
    after_paths = set(after_files.keys())

    added = sorted(after_paths - before_paths)
    removed = sorted(before_paths - after_paths)
    modified = sorted(
        path
        for path in before_paths & after_paths
        if before_files[path] != after_files[path]
    )

    return {
        "added": [{"path": path, **after_files[path]} for path in added],
        "removed": [{"path": path, **before_files[path]} for path in removed],
        "modified": [
            {
                "path": path,
                "before": before_files[path],
                "after": after_files[path],
            }
            for path in modified
        ],
        "counts": {
            "added": len(added),
            "removed": len(removed),
            "modified": len(modified),
        },
        "warnings": before.get("warnings", []) + after.get("warnings", []),
    }


def strip_ansi(data: bytes) -> str:
    plain = ANSI_RE.sub(b"", data)
    plain = plain.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return plain.decode("utf-8", errors="replace")


def read_pty_for(
    master_fd: int,
    process: subprocess.Popen[bytes],
    duration: float,
    chunks: list[bytes],
    max_bytes: int,
    forward_stdout: bool = False,
    terminal_query_response: bool = True,
) -> None:
    deadline = time.monotonic() + max(0.0, duration)
    while time.monotonic() < deadline:
        if sum(len(chunk) for chunk in chunks) >= max_bytes:
            return
        timeout = min(0.1, max(0.0, deadline - time.monotonic()))
        readable, _, _ = select.select([master_fd], [], [], timeout)
        if master_fd in readable:
            try:
                data = os.read(master_fd, 4096)
            except OSError:
                return
            if not data:
                return
            chunks.append(data)
            if terminal_query_response:
                respond_to_terminal_queries(master_fd, data)
            if forward_stdout:
                os.write(sys.stdout.fileno(), data)
        if process.poll() is not None:
            read_remaining(master_fd, chunks, max_bytes, forward_stdout)
            return


def read_remaining(
    master_fd: int,
    chunks: list[bytes],
    max_bytes: int,
    forward_stdout: bool = False,
    terminal_query_response: bool = True,
) -> None:
    while sum(len(chunk) for chunk in chunks) < max_bytes:
        readable, _, _ = select.select([master_fd], [], [], 0)
        if master_fd not in readable:
            return
        try:
            data = os.read(master_fd, 4096)
        except OSError:
            return
        if not data:
            return
        chunks.append(data)
        if terminal_query_response:
            respond_to_terminal_queries(master_fd, data)
        if forward_stdout:
            os.write(sys.stdout.fileno(), data)


def respond_to_terminal_queries(master_fd: int, data: bytes) -> None:
    responses: list[bytes] = []
    if b"\x1b[6n" in data:
        responses.append(b"\x1b[1;1R")
    if b"\x1b[c" in data:
        responses.append(b"\x1b[?1;2c")
    if b"\x1b[?u" in data:
        responses.append(b"\x1b[?0u")
    if b"\x1b]10;?\x1b\\" in data or b"\x1b]10;?\x07" in data:
        responses.append(b"\x1b]10;rgb:ffff/ffff/ffff\x1b\\")
    if b"\x1b]11;?\x1b\\" in data or b"\x1b]11;?\x07" in data:
        responses.append(b"\x1b]11;rgb:0000/0000/0000\x1b\\")
    for response in responses:
        os.write(master_fd, response)


def terminate_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            return
        except PermissionError:
            try:
                process.send_signal(sig)
            except ProcessLookupError:
                return
            except PermissionError:
                continue
        try:
            process.wait(timeout=2)
            return
        except subprocess.TimeoutExpired:
            continue


def run_noninteractive_pty(
    command: list[str],
    cwd: pathlib.Path,
    env: dict[str, str],
    args: argparse.Namespace,
) -> tuple[bytes, dict[str, Any]]:
    master_fd, slave_fd = os.openpty()
    set_pty_window_size(slave_fd, args.rows, args.cols)
    chunks: list[bytes] = []
    started_at = time.time()
    process = subprocess.Popen(
        command,
        cwd=str(cwd),
        env=env,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        start_new_session=True,
    )
    os.close(slave_fd)
    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    try:
        if args.scenario == "observe":
            read_pty_for(master_fd, process, args.timeout, chunks, args.max_bytes)
        elif args.scenario == "permission":
            read_pty_for(master_fd, process, args.startup_wait, chunks, args.max_bytes)
            for key in args.key:
                os.write(master_fd, key_to_bytes(key))
                read_pty_for(master_fd, process, args.key_wait, chunks, args.max_bytes)
            read_pty_for(master_fd, process, args.after_submit_wait, chunks, args.max_bytes)
        else:
            read_pty_for(master_fd, process, args.startup_wait, chunks, args.max_bytes)
            if args.prompt:
                os.write(master_fd, args.prompt.encode("utf-8"))
                read_pty_for(master_fd, process, args.pre_submit_wait, chunks, args.max_bytes)
            submit_bytes = KEY_BYTES[args.submit]
            if submit_bytes:
                os.write(master_fd, submit_bytes)
            for key in args.key:
                os.write(master_fd, key_to_bytes(key))
                read_pty_for(master_fd, process, args.key_wait, chunks, args.max_bytes)
            read_pty_for(master_fd, process, args.after_submit_wait, chunks, args.max_bytes)
    finally:
        terminate_process(process)
        read_remaining(master_fd, chunks, args.max_bytes)
        os.close(master_fd)

    return b"".join(chunks), {
        "pid": process.pid,
        "returncode": process.returncode,
        "started_at": started_at,
        "ended_at": time.time(),
    }


def run_manual_pty(
    command: list[str],
    cwd: pathlib.Path,
    env: dict[str, str],
    args: argparse.Namespace,
) -> tuple[bytes, dict[str, Any], list[str]]:
    master_fd, slave_fd = os.openpty()
    set_pty_window_size(slave_fd, args.rows, args.cols)
    chunks: list[bytes] = []
    warnings: list[str] = []
    started_at = time.time()
    process = subprocess.Popen(
        command,
        cwd=str(cwd),
        env=env,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        start_new_session=True,
    )
    os.close(slave_fd)
    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()
    old_attrs = None

    try:
        if not sys.stdin.isatty():
            warnings.append("stdin is not a TTY; manual scenario captured output only")
            read_pty_for(master_fd, process, args.timeout, chunks, args.max_bytes, True)
        else:
            old_attrs = termios.tcgetattr(stdin_fd)
            tty.setraw(stdin_fd)
            deadline = time.monotonic() + args.timeout
            while time.monotonic() < deadline and process.poll() is None:
                readable, _, _ = select.select([master_fd, stdin_fd], [], [], 0.1)
                if master_fd in readable:
                    try:
                        data = os.read(master_fd, 4096)
                    except OSError:
                        break
                    if not data:
                        break
                    chunks.append(data)
                    os.write(stdout_fd, data)
                if stdin_fd in readable:
                    data = os.read(stdin_fd, 4096)
                    if data:
                        os.write(master_fd, data)
    finally:
        if old_attrs is not None:
            termios.tcsetattr(stdin_fd, termios.TCSADRAIN, old_attrs)
        terminate_process(process)
        read_remaining(master_fd, chunks, args.max_bytes, True)
        os.close(master_fd)

    return b"".join(chunks), {
        "pid": process.pid,
        "returncode": process.returncode,
        "started_at": started_at,
        "ended_at": time.time(),
    }, warnings


def key_to_bytes(key: str) -> bytes:
    if key in KEY_BYTES:
        return KEY_BYTES[key]
    if key.startswith("text:"):
        return key[len("text:") :].encode("utf-8")
    if key.startswith("hex:"):
        return bytes.fromhex(key[len("hex:") :])
    raise SystemExit(f"Unknown key: {key}")


def codex_permission_hooks_path(output_dir: pathlib.Path) -> pathlib.Path:
    return output_dir / "provider-home" / "codex" / "hooks.json"


def claude_permission_settings_path(output_dir: pathlib.Path) -> pathlib.Path:
    return output_dir / "provider-home" / "claude" / "settings.json"


def toml_string(value: str) -> str:
    return json.dumps(value)


def codex_hook_group_toml(command: str, matcher: str | None = None) -> str:
    matcher_part = ""
    if matcher is not None:
        matcher_part = f"matcher={toml_string(matcher)},"
    return (
        "[{"
        f"{matcher_part}"
        f"hooks=[{{type=\"command\",command={toml_string(command)}}}]"
        "}]"
    )


def codex_signal_paths(output_dir: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path]:
    signals_dir = output_dir / "signals"
    return (
        signals_dir / "provider-signals.jsonl",
        signals_dir / "capture-provider-signal.py",
    )


def add_permission_command_context(
    command: list[str],
    args: argparse.Namespace,
    output_dir: pathlib.Path,
) -> list[str]:
    if args.scenario != "permission":
        return command
    if args.agent != "codex":
        return command
    signal_file, hook_script = codex_signal_paths(output_dir)
    user_prompt_hook = capture_hook_command(
        hook_script, "UserPromptSubmit", signal_file, "codex"
    )
    permission_hook = capture_hook_command(
        hook_script, "PermissionRequest", signal_file, "codex"
    )
    stop_hook = capture_hook_command(hook_script, "Stop", signal_file, "codex")
    return [
        *command,
        "-c",
        f"hooks.UserPromptSubmit={codex_hook_group_toml(user_prompt_hook)}",
        "-c",
        f"hooks.PermissionRequest={codex_hook_group_toml(permission_hook, matcher='Bash')}",
        "-c",
        f"hooks.Stop={codex_hook_group_toml(stop_hook)}",
        args.prompt,
    ]


def add_claude_permission_command_context(
    command: list[str],
    args: argparse.Namespace,
    output_dir: pathlib.Path,
) -> list[str]:
    if args.scenario != "permission":
        return command
    if args.agent != "claude":
        return command
    return [
        *command,
        "--settings",
        str(claude_permission_settings_path(output_dir)),
        args.prompt,
    ]


def set_pty_window_size(fd: int, rows: int, cols: int) -> None:
    size = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, size)


def write_json(path: pathlib.Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def capture_hook_command(
    script_path: pathlib.Path,
    event_name: str,
    signal_file: pathlib.Path,
    agent: str,
) -> str:
    return " ".join(
        [
            f"TIDE_PROVIDER_SIGNAL_AGENT={shlex.quote(agent)}",
            f"TIDE_PROVIDER_SIGNAL_FILE={shlex.quote(str(signal_file))}",
            shlex.quote(sys.executable),
            shlex.quote(str(script_path)),
            shlex.quote(event_name),
        ]
    )


def write_signal_capture_script(script_path: pathlib.Path) -> None:
    script_path.write_text(
        """#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import sys

event = sys.argv[1] if len(sys.argv) > 1 else "unknown"
raw = sys.stdin.read()
payload = None
payload_error = None

if raw.strip():
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        payload_error = str(exc)

record = {
    "timestamp": dt.datetime.now(dt.timezone.utc).isoformat(),
    "agent": os.environ.get("TIDE_PROVIDER_SIGNAL_AGENT"),
    "event": event,
    "raw": raw,
    "payload": payload,
    "payload_error": payload_error,
}

signal_file = pathlib.Path(os.environ["TIDE_PROVIDER_SIGNAL_FILE"])
signal_file.parent.mkdir(parents=True, exist_ok=True)
with signal_file.open("a", encoding="utf-8") as f:
    f.write(json.dumps(record, sort_keys=True) + "\\n")
""",
        encoding="utf-8",
    )
    script_path.chmod(0o755)


def append_command_hook(
    hooks: dict[str, Any],
    event_name: str,
    command: str,
    matcher: str | None = None,
) -> None:
    groups = hooks.setdefault(event_name, [])
    if not isinstance(groups, list):
        hooks[event_name] = []
        groups = hooks[event_name]
    group: dict[str, Any] = {
        "hooks": [
            {
                "type": "command",
                "command": command,
            }
        ]
    }
    if matcher is not None:
        group["matcher"] = matcher
    groups.append(group)


def prepare_codex_signal_capture(
    output_dir: pathlib.Path,
    env: dict[str, str],
    warnings: list[str],
) -> dict[str, Any]:
    signal_file, hook_script = codex_signal_paths(output_dir)
    signals_dir = signal_file.parent
    signals_dir.mkdir(parents=True, exist_ok=True)
    signal_file.touch()
    write_signal_capture_script(hook_script)

    hooks_file = codex_permission_hooks_path(output_dir)
    hooks_file.parent.mkdir(parents=True, exist_ok=True)
    hooks_data: dict[str, Any] = {}
    hooks = hooks_data.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        hooks_data["hooks"] = {}
        hooks = hooks_data["hooks"]

    append_command_hook(
        hooks,
        "UserPromptSubmit",
        capture_hook_command(hook_script, "UserPromptSubmit", signal_file, "codex"),
    )
    append_command_hook(
        hooks,
        "PermissionRequest",
        capture_hook_command(hook_script, "PermissionRequest", signal_file, "codex"),
        matcher="Bash",
    )
    append_command_hook(
        hooks,
        "Stop",
        capture_hook_command(hook_script, "Stop", signal_file, "codex"),
    )
    write_json(hooks_file, hooks_data)

    env["TIDE_PROVIDER_SIGNAL_AGENT"] = "codex"
    env["TIDE_PROVIDER_SIGNAL_FILE"] = str(signal_file)

    return {
        "enabled": True,
        "agent": "codex",
        "signal_path": str(signal_file),
        "hook_script_path": str(hook_script),
        "hooks_path": str(hooks_file),
    }


def prepare_claude_signal_capture(
    output_dir: pathlib.Path,
    env: dict[str, str],
    warnings: list[str],
) -> dict[str, Any]:
    signal_file, hook_script = codex_signal_paths(output_dir)
    signals_dir = signal_file.parent
    signals_dir.mkdir(parents=True, exist_ok=True)
    signal_file.touch()
    write_signal_capture_script(hook_script)

    settings_file = claude_permission_settings_path(output_dir)
    settings_file.parent.mkdir(parents=True, exist_ok=True)
    hooks_data: dict[str, Any] = {"hooks": {}}
    hooks = hooks_data["hooks"]
    append_command_hook(
        hooks,
        "UserPromptSubmit",
        capture_hook_command(hook_script, "UserPromptSubmit", signal_file, "claude"),
        matcher="",
    )
    append_command_hook(
        hooks,
        "PermissionRequest",
        capture_hook_command(hook_script, "PermissionRequest", signal_file, "claude"),
        matcher="Bash",
    )
    append_command_hook(
        hooks,
        "Notification",
        capture_hook_command(hook_script, "Notification", signal_file, "claude"),
        matcher="",
    )
    append_command_hook(
        hooks,
        "Stop",
        capture_hook_command(hook_script, "Stop", signal_file, "claude"),
        matcher="",
    )
    write_json(settings_file, hooks_data)

    env["TIDE_PROVIDER_SIGNAL_AGENT"] = "claude"
    env["TIDE_PROVIDER_SIGNAL_FILE"] = str(signal_file)

    return {
        "enabled": True,
        "agent": "claude",
        "signal_path": str(signal_file),
        "hook_script_path": str(hook_script),
        "settings_path": str(settings_file),
    }


def prepare_signal_capture(
    args: argparse.Namespace,
    output_dir: pathlib.Path,
    env: dict[str, str],
    warnings: list[str],
) -> dict[str, Any]:
    if args.scenario != "permission":
        return {"enabled": False}
    if args.agent == "codex":
        return prepare_codex_signal_capture(output_dir, env, warnings)
    if args.agent == "claude":
        return prepare_claude_signal_capture(output_dir, env, warnings)
    raise SystemExit("--scenario permission currently supports --agent codex or claude")


def count_jsonl_records(path: pathlib.Path | None) -> int:
    if path is None or not path.exists():
        return 0
    with path.open("r", encoding="utf-8") as f:
        return sum(1 for line in f if line.strip())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Collect bounded PTY evidence for Tide v2 Agent Integrations."
    )
    parser.add_argument("--agent", choices=sorted(AGENTS), required=True)
    parser.add_argument(
        "--scenario",
        choices=["observe", "message", "manual", "resume", "permission"],
        default="observe",
    )
    parser.add_argument("--cwd", default=os.getcwd())
    parser.add_argument("--prompt", default="")
    parser.add_argument("--resume-ref", help="Provider-native session or conversation id for resume scenario.")
    parser.add_argument(
        "--submit",
        choices=sorted(KEY_BYTES),
        default=None,
        help="Defaults to provider-specific submit key.",
    )
    parser.add_argument("--command", help="Override provider executable.")
    parser.add_argument("--arg", action="append", default=[], help="Argument for --command.")
    parser.add_argument("--env", action="append", default=[], help="Extra KEY=VALUE env.")
    parser.add_argument("--state-root", action="append", help="Override state root.")
    parser.add_argument("--output-root", default="/private/tmp/tide-provider-evidence")
    parser.add_argument("--startup-wait", type=float, default=2.0)
    parser.add_argument("--pre-submit-wait", type=float, default=0.2)
    parser.add_argument("--after-submit-wait", type=float, default=12.0)
    parser.add_argument(
        "--key",
        action="append",
        default=[],
        help="Extra key to send; permission scenarios send keys after startup.",
    )
    parser.add_argument("--key-wait", type=float, default=0.25)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--max-bytes", type=int, default=512_000)
    parser.add_argument("--max-state-files", type=int, default=1_000)
    parser.add_argument("--max-state-dirs", type=int, default=300)
    parser.add_argument("--cols", type=int, default=120)
    parser.add_argument("--rows", type=int, default=40)
    parser.add_argument(
        "--codex-temp-home",
        action="store_true",
        help="Run Codex with a temporary CODEX_HOME copied from auth/config only.",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    defaults = AGENTS[args.agent]
    if args.submit is None:
        args.submit = defaults.submit
    if args.scenario == "permission" and not args.prompt:
        if args.agent == "codex":
            args.prompt = DEFAULT_CODEX_PERMISSION_PROMPT
        elif args.agent == "claude":
            args.prompt = DEFAULT_CLAUDE_PERMISSION_PROMPT
    if args.scenario == "permission" and args.startup_wait == 2.0:
        args.startup_wait = 5.0

    cwd = pathlib.Path(args.cwd).expanduser().resolve()
    state_roots = resolve_state_roots(args)
    output_root = pathlib.Path(args.output_root).expanduser().resolve()
    run_id = f"{now_stamp()}-{args.agent}-{args.scenario}"
    output_dir = output_root / run_id
    command = add_claude_permission_command_context(
        add_permission_command_context(resolve_command(args), args, output_dir),
        args,
        output_dir,
    )

    plan = {
        "run_id": run_id,
        "agent": args.agent,
        "scenario": args.scenario,
        "command": command,
        "cwd": str(cwd),
        "resume_ref": args.resume_ref,
        "prompt": args.prompt,
        "submit": args.submit,
        "state_roots": [str(root) for root in state_roots],
        "output_dir": str(output_dir),
        "limits": {
            "timeout": args.timeout,
            "max_bytes": args.max_bytes,
            "max_state_files": args.max_state_files,
            "max_state_dirs": args.max_state_dirs,
            "cols": args.cols,
            "rows": args.rows,
        },
        "signals": {
            "enabled": args.scenario == "permission",
            "provider": args.agent if args.scenario == "permission" else None,
        },
    }

    if args.dry_run:
        print(json.dumps(plan, indent=2, sort_keys=True))
        return 0

    if not cwd.exists():
        raise SystemExit(f"cwd does not exist: {cwd}")
    require_command_available(command)

    output_dir.mkdir(parents=True, exist_ok=False)

    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env.update(parse_env(args.env))

    warnings: list[str] = []
    temp_home_context: tempfile.TemporaryDirectory[str] | None = None
    try:
        if args.codex_temp_home:
            if args.agent != "codex":
                raise SystemExit("--codex-temp-home is only supported for --agent codex")
            temp_home_context = tempfile.TemporaryDirectory(prefix="tide-codex-home-")
            temp_codex_home = pathlib.Path(temp_home_context.name)
            user_codex_home = pathlib.Path(os.environ.get("CODEX_HOME", "~/.codex")).expanduser()
            for name in ["auth.json", "config.toml"]:
                source = user_codex_home / name
                if source.exists():
                    shutil.copy2(source, temp_codex_home / name)
            env["CODEX_HOME"] = str(temp_codex_home)
            warnings.append("codex-temp-home copied auth/config and deletes temporary state after run")

        signal_info = prepare_signal_capture(args, output_dir, env, warnings)
        before = snapshot_state(state_roots, args.max_state_files, args.max_state_dirs)
        warnings.extend(before.get("warnings", []))

        if args.scenario == "manual":
            transcript, process_info, manual_warnings = run_manual_pty(command, cwd, env, args)
            warnings.extend(manual_warnings)
        else:
            transcript, process_info = run_noninteractive_pty(command, cwd, env, args)

        after = snapshot_state(state_roots, args.max_state_files, args.max_state_dirs)
        warnings.extend(after.get("warnings", []))
        state_diff = diff_state(before, after)
        warnings.extend(state_diff.get("warnings", []))
    finally:
        if temp_home_context is not None:
            temp_home_context.cleanup()

    (output_dir / "pty-transcript.ansi").write_bytes(transcript)
    (output_dir / "pty-transcript.txt").write_text(strip_ansi(transcript), encoding="utf-8")
    write_json(output_dir / "state-before.json", before)
    write_json(output_dir / "state-after.json", after)
    write_json(output_dir / "state-diff.json", state_diff)

    signal_path = None
    if signal_info.get("enabled"):
        signal_path = pathlib.Path(signal_info["signal_path"])
        signal_info = {
            **signal_info,
            "count": count_jsonl_records(signal_path),
        }

    manifest = {
        **plan,
        "process": process_info,
        "transcript": {
            "ansi_path": str(output_dir / "pty-transcript.ansi"),
            "text_path": str(output_dir / "pty-transcript.txt"),
            "bytes": len(transcript),
            "truncated_by_max_bytes": len(transcript) >= args.max_bytes,
        },
        "state": {
            "before_path": str(output_dir / "state-before.json"),
            "after_path": str(output_dir / "state-after.json"),
            "diff_path": str(output_dir / "state-diff.json"),
            "diff_counts": state_diff["counts"],
        },
        "signals": signal_info,
        "warnings": sorted(set(warnings)),
    }
    write_json(output_dir / "manifest.json", manifest)
    print(str(output_dir))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
