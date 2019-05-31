import { Injectable, Autowired } from '@ali/common-di';
import { LanguageClientFactory, ILanguageClient } from './language-client-factory';
import { LanguageContribution } from '../common';
import { CommandContribution } from '@ali/ide-core-node';
import { LanguageClientOptions } from 'monaco-languageclient';
import { listen } from 'vscode-ws-jsonrpc';

// TODO 迁移到connection模块
@Injectable()
export class ConnectionFactory {
  baseUrl = 'ws:127.0.0.1:8000';

  get(id: string) {
    return new WebSocket(`${this.baseUrl}/language/${id}`);
  }
}

export abstract class LanguageClientContribution implements LanguageContribution, CommandContribution {
  abstract readonly id: string;
  abstract readonly name: string;

  clientOptions: LanguageClientOptions = {};

  private languageClient: ILanguageClient;

  // NOTE 连接需要使用connection模块提供的
  private connection: any;

  @Autowired()
  private connectionFactory: ConnectionFactory;

  @Autowired()
  private languageClientFactory: LanguageClientFactory;

  // TODO 等应用生命周期
  waitForActivate() {

  }

  // TODO 迁移到 waitForActivate 中
  registerCommands(commands) {
    commands.registerCommands({
      id: `language.client.${this.id}.activate`,
    }, {
      execute: () => {
        console.log('language activate: ' + this.id);
        this.activate();
      },
    });
  }

  activate() {
    this.connection = this.connectionFactory.get(this.id);
    this.languageClient = this.languageClientFactory.get(this, this.clientOptions, this.connection);
    this.languageClient.onDidChangeState((e) => {
      console.log('这是啥？', e);
    });
    this.doActivate();
  }

  // TODO dispose逻辑
  doActivate() {
    listen({
      webSocket: this.connection,
      onConnection: (connection: any) => {
        const disposable = this.languageClient.start();
        connection.onClose(() => disposable.dispose());
      },
    });
  }

}
