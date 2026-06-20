import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  PtyLaunchPlan,
  PtyProcessHandle,
  PtyProcessLauncher,
  PtyProcessSpawnInput,
} from "./pty-process.ts";

export function createPythonPtyProcessLauncher(): PtyProcessLauncher {
  return new PythonPtyProcessLauncher();
}

class PythonPtyProcessLauncher implements PtyProcessLauncher {
  async spawn(input: PtyProcessSpawnInput): Promise<PtyProcessHandle> {
    const child = spawnProcess(input.plan, input.emulateTerminalQueries ?? true);
    tracePtyLauncher(`spawned runtime=${input.runtimeId} command=${input.plan.command}`);
    child.stdout.on("data", (chunk: Buffer) => {
      tracePtyLauncher(`stdout runtime=${input.runtimeId} bytes=${chunk.byteLength}`);
      input.onOutput?.({ source: "stdout", body: chunk.toString("utf8") });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      tracePtyLauncher(`stderr runtime=${input.runtimeId} bytes=${chunk.byteLength}`);
      input.onOutput?.({ source: "stderr", body: chunk.toString("utf8") });
    });
    child.on("exit", (exitCode, signal) => {
      tracePtyLauncher(`exit runtime=${input.runtimeId} code=${exitCode} signal=${signal}`);
      input.onExit?.({ exitCode, signal });
    });
    return new ChildProcessPtyHandle(input.runtimeId, child);
  }
}

class ChildProcessPtyHandle implements PtyProcessHandle {
  readonly runtimeId: string;
  private readonly child: ChildProcessWithoutNullStreams;

  constructor(
    runtimeId: string,
    child: ChildProcessWithoutNullStreams,
  ) {
    this.runtimeId = runtimeId;
    this.child = child;
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  write(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.child.stdin.write(data, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  // Resize the PTY so the shell's view matches the rendered terminal (cols/rows),
  // sent over the dedicated control pipe (fd 3) the bridge listens on. Without
  // this the shell stays at its spawn size and cursor-relative redraws (e.g.
  // starship's async prompt) land wrong. Best-effort; ignored if the pipe is gone.
  resize(cols: number, rows: number): void {
    const control = this.child.stdio[3];
    if (control && typeof (control as { write?: unknown }).write === "function") {
      const safeCols = Math.max(1, Math.floor(cols));
      const safeRows = Math.max(1, Math.floor(rows));
      try {
        (control as NodeJS.WritableStream).write(`${safeRows},${safeCols}\n`);
      } catch {
        // Control pipe closed (process exiting) — ignore.
      }
    }
  }

  stop(): Promise<void> {
    this.child.kill("SIGTERM");
    return Promise.resolve();
  }
}

function spawnProcess(
  plan: PtyLaunchPlan,
  emulateTerminalQueries = true,
): ChildProcessWithoutNullStreams {
  const env = {
    ...process.env,
    ...plan.env,
    EMULATE_TERMINAL_QUERIES: emulateTerminalQueries ? "1" : "0",
  };

  // fd 0-2 are the PTY stdio; fd 3 is a dedicated control pipe the bridge reads
  // resize messages ("rows,cols\n") from.
  return spawn("python3", [
    "-c",
    pythonPtyBridgeSource,
    plan.command,
    ...plan.args,
  ], {
    cwd: plan.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
}

const pythonPtyBridgeSource = String.raw`
import errno
import fcntl
import os
import selectors
import signal
import struct
import subprocess
import sys
import termios

emulate_terminal_queries = os.environ.pop("EMULATE_TERMINAL_QUERIES", "1") == "1"
command = sys.argv[1:]
if not command:
    sys.stderr.write("missing pty command\n")
    sys.exit(2)

master_fd, slave_fd = os.openpty()

# Give the slave a sane interactive line discipline. A freshly opened PTY can
# ship with ECHOE cleared, which makes the kernel erase the input buffer on
# Backspace but NOT emit the visual BS-SP-BS — so at a shell prompt Backspace
# looks like it does nothing. Force canonical mode + visible erase (VERASE=DEL,
# matching what xterm sends). Full-screen apps (vim, less) still set raw mode
# themselves, so this only governs the shell's own line editing.
try:
    attrs = termios.tcgetattr(slave_fd)
    attrs[0] |= termios.ICRNL | getattr(termios, "IUTF8", 0)
    attrs[1] |= termios.OPOST | termios.ONLCR
    attrs[3] |= (
        termios.ICANON | termios.ECHO | termios.ECHOE | termios.ECHOK
        | termios.ISIG | termios.IEXTEN
    )
    attrs[6][termios.VERASE] = 0x7f
    termios.tcsetattr(slave_fd, termios.TCSANOW, attrs)
except (termios.error, OSError):
    pass

fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
child = subprocess.Popen(
    command,
    stdin=slave_fd,
    stdout=slave_fd,
    stderr=slave_fd,
    close_fds=True,
    start_new_session=True,
)
os.close(slave_fd)

# fd 3 is a control pipe carrying "rows,cols\n" resize messages from the host.
control_fd = 3
control_open = True
control_buffer = b""
try:
    os.set_blocking(control_fd, False)
except OSError:
    control_open = False

def apply_resize(line):
    try:
        rows_str, cols_str = line.split(b",", 1)
        rows = int(rows_str)
        cols = int(cols_str)
    except (ValueError, IndexError):
        return
    if rows > 0 and cols > 0:
        try:
            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        except OSError:
            pass

selector = selectors.DefaultSelector()
selector.register(master_fd, selectors.EVENT_READ, "pty")
selector.register(sys.stdin.buffer, selectors.EVENT_READ, "stdin")
if control_open:
    selector.register(control_fd, selectors.EVENT_READ, "control")

def write_terminal_query_replies(master_fd, data):
    responses = []
    if b"\x1b[6n" in data:
        responses.append(b"\x1b[1;1R")
    if b"\x1b]10;?\x1b\\" in data or b"\x1b]10;?\x07" in data:
        responses.append(b"\x1b]10;rgb:ffff/ffff/ffff\x1b\\")
    if b"\x1b]11;?\x1b\\" in data or b"\x1b]11;?\x07" in data:
        responses.append(b"\x1b]11;rgb:0000/0000/0000\x1b\\")
    if b"\x1b[c" in data:
        responses.append(b"\x1b[?1;2c")
    if b"\x1b[?u" in data:
        responses.append(b"\x1b[?0u")

    for response in responses:
        os.write(master_fd, response)

def terminate_child(signum, frame):
    # Escalate: SIGTERM, then SIGKILL if it won't go. A reaped agent must actually
    # die — if it lingered on the closed PTY it would spin CPU as an orphan.
    try:
        child.terminate()
    except ProcessLookupError:
        return
    try:
        child.wait(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            child.kill()
        except ProcessLookupError:
            pass

signal.signal(signal.SIGTERM, terminate_child)
signal.signal(signal.SIGINT, terminate_child)

stdin_open = True
while True:
    if child.poll() is not None:
        break

    # The agent runs in its own session (start_new_session), so if the Tide backend
    # that spawned us dies, this bridge is reparented to init (ppid 1) and the agent
    # would otherwise survive as a CPU-spinning orphan on a dead PTY. Reap it.
    if os.getppid() == 1:
        terminate_child(None, None)
        break

    for key, _events in selector.select(timeout=0.1):
        if key.data == "pty":
            try:
                data = os.read(master_fd, 4096)
            except OSError as error:
                if error.errno in (errno.EIO, errno.EBADF):
                    data = b""
                else:
                    raise
            if data:
                if emulate_terminal_queries:
                    write_terminal_query_replies(master_fd, data)
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
        elif key.data == "stdin" and stdin_open:
            data = sys.stdin.buffer.read1(4096)
            if data:
                os.write(master_fd, data)
            else:
                selector.unregister(sys.stdin.buffer)
                stdin_open = False
        elif key.data == "control" and control_open:
            try:
                chunk = os.read(control_fd, 1024)
            except OSError:
                chunk = b""
            if chunk:
                control_buffer += chunk
                while b"\n" in control_buffer:
                    line, control_buffer = control_buffer.split(b"\n", 1)
                    if line:
                        apply_resize(line)
            else:
                selector.unregister(control_fd)
                control_open = False

try:
    while True:
        data = os.read(master_fd, 4096)
        if not data:
            break
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
except OSError as error:
    if error.errno not in (errno.EIO, errno.EBADF):
        raise
finally:
    os.close(master_fd)

sys.exit(child.returncode if child.returncode is not None else 0)
`;

function tracePtyLauncher(message: string): void {
  if (process.env.TIDE_BACKEND_TRACE !== "1") {
    return;
  }
  process.stdout.write(`[tide-pty] ${message}\n`);
}
