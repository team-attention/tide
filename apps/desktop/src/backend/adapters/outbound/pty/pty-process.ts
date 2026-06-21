// The PTY process contract. Used by the workbench terminal and the
// provider readiness terminal (auth/login) — the only PTY consumers left after the
// agent runtimes moved to structured protocols. (Agents no longer spawn PTYs.)

export interface PtyLaunchPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export interface PtyProcessHandle {
  runtimeId: string;
  pid?: number;
  write(data: string): Promise<void> | void;
  resize?(cols: number, rows: number): void;
  stop(): Promise<void> | void;
}

export interface PtyProcessOutput {
  source: "stdout" | "stderr";
  body: string;
}

export interface PtyProcessExit {
  exitCode: number | null;
  signal: string | null;
}

export interface PtyProcessSpawnInput {
  runtimeId: string;
  plan: PtyLaunchPlan;
  // Hidden PTY consumers have no frontend terminal emulator, so the bridge can
  // answer common terminal capability queries. Visible Workbench terminals use
  // xterm.js, which must own those replies to avoid duplicate CPR bytes in stdin.
  emulateTerminalQueries?: boolean;
  onOutput?: (output: PtyProcessOutput) => void;
  onExit?: (exit: PtyProcessExit) => void;
}

export interface PtyProcessLauncher {
  spawn(input: PtyProcessSpawnInput): Promise<PtyProcessHandle>;
}
