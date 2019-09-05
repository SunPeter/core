import { Injectable } from '@ali/common-di';
import { RPCService } from '@ali/ide-connection';
import { PtyService, pty } from './pty';
import { ITerminalService, TerminalOptions } from '../common';

@Injectable()
export class TerminalServiceImpl extends RPCService implements ITerminalService {
  private terminalMap: Map<string, pty.IPty> = new Map();
  private ptyService = new PtyService();

  public create(id: string, rows: number, cols: number, options: TerminalOptions) {
    const terminal = this.ptyService.create(rows, cols, options);

    console.log('terminal', terminal.process);
    console.log('terminal', terminal.pid);

    terminal.on('data', (data) => {
      if (this.rpcClient) {
        this.rpcClient[0].onMessage(id, data);
      }
    });
    this.terminalMap.set(id , terminal);
    return {
      pid: terminal.pid,
      process: terminal.process,
    };
  }

  public onMessage(id, msg) {
    const terminal = this.getTerminal(id);

    if (!terminal) {
      return;
    }
    terminal.write(msg);
  }

  public resize(id, rows, cols) {
    const terminal = this.getTerminal(id);

    if (!terminal) {
      return;
    }
    this.ptyService.resize(terminal, rows, cols);
  }

  getShellName(id: string): string | undefined {
    const terminal = this.getTerminal(id);

    if (!terminal) {
      return ;
    }
    return terminal.process;
  }

  getProcessId(id: string): number | undefined {
    const terminal = this.getTerminal(id);

    if (!terminal) {
      return ;
    }
    return terminal.pid;
  }

  disposeById(id: string) {
    const terminal = this.getTerminal(id);

    if (!terminal) {
      return;
    }
    terminal.kill();
  }

  dispose() {
    this.terminalMap.forEach((term) => {
      term.kill();
    });
  }

  private getTerminal(id: string) {
    return this.terminalMap.get(id);
  }
}
