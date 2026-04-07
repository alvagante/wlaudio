import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';

export interface TerminalSession {
  terminalId: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
}

interface TerminalEntry {
  proc: pty.IPty;
  meta: TerminalSession;
}

// Strip undefined values — node-pty rejects them at the native layer
function safeEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
}

class TerminalManager extends EventEmitter {
  private terminals = new Map<string, TerminalEntry>();

  create(terminalId: string, cwd: string, cols: number, rows: number): void {
    if (this.terminals.has(terminalId)) return;

    // Resolve cwd — fall back to home if the path doesn't exist
    const resolvedCwd = existsSync(cwd) ? cwd : (process.env['HOME'] ?? '/tmp');

    const shell = process.env['SHELL'] ?? '/bin/zsh';

    let proc: pty.IPty;
    try {
      // Spawn an interactive login shell so ~/.zshrc / ~/.bash_profile loads
      // and `claude` is in PATH exactly as it would be in a real terminal.
      proc = pty.spawn(shell, ['-l'], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: resolvedCwd,
        env: safeEnv(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('output', terminalId, `\r\n\x1b[31m[wlaudio] Failed to spawn shell: ${msg}\x1b[0m\r\n`);
      this.emit('exit', terminalId, 1);
      return;
    }

    const meta: TerminalSession = { terminalId, cwd: resolvedCwd, cols, rows, createdAt: Date.now() };
    this.terminals.set(terminalId, { proc, meta });

    proc.onData((data: string) => {
      this.emit('output', terminalId, data);
    });

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      this.terminals.delete(terminalId);
      this.emit('exit', terminalId, exitCode);
    });

    // After a short delay, auto-run claude in the login shell
    setTimeout(() => {
      if (this.terminals.has(terminalId)) {
        proc.write('claude\r');
      }
    }, 400);
  }

  write(terminalId: string, data: string): void {
    this.terminals.get(terminalId)?.proc.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const entry = this.terminals.get(terminalId);
    if (!entry) return;
    entry.proc.resize(cols, rows);
    entry.meta.cols = cols;
    entry.meta.rows = rows;
  }

  kill(terminalId: string): void {
    const entry = this.terminals.get(terminalId);
    if (!entry) return;
    entry.proc.kill();
    this.terminals.delete(terminalId);
  }

  list(): TerminalSession[] {
    return [...this.terminals.values()].map(e => e.meta);
  }

  killAll(): void {
    for (const { proc } of this.terminals.values()) {
      proc.kill();
    }
    this.terminals.clear();
  }
}

export const terminalManager = new TerminalManager();
