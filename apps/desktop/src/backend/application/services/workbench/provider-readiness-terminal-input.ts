function shellName(shellCommand: string): string {
  const normalized = shellCommand.replaceAll("\\", "/").toLowerCase();
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function providerReadinessTerminalInput(input: {
  command: string;
  args: string[];
  shellCommand: string;
}): string {
  const shell = shellName(input.shellCommand);
  if (shell === "cmd" || shell === "cmd.exe") {
    return `${[input.command, ...input.args].map(cmdQuote).join(" ")} & exit\r`;
  }
  if (
    shell === "powershell" ||
    shell === "powershell.exe" ||
    shell === "pwsh" ||
    shell === "pwsh.exe"
  ) {
    return `& ${[input.command, ...input.args].map(powerShellQuote).join(" ")}; exit $LASTEXITCODE\r`;
  }
  return `exec ${[input.command, ...input.args].map(posixQuote).join(" ")}\r`;
}

function cmdQuote(value: string): string {
  if (/^[A-Za-z0-9_/:.,+=-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("%", "^%").replaceAll("!", "^!").replaceAll('"', '^"')}"`;
}

function powerShellQuote(value: string): string {
  return /^[A-Za-z0-9_/:.,@%+=-]+$/.test(value) ? value : `'${value.replaceAll("'", "''")}'`;
}

function posixQuote(value: string): string {
  return /^[A-Za-z0-9_/:.,@%+=-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
