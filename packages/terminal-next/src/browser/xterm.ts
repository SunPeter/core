/* eslint-disable @typescript-eslint/ban-ts-comment */
import { ITerminalOptions, ITheme, Terminal } from 'xterm';
import type { CanvasAddon as CanvasAddonType } from 'xterm-addon-canvas';
import { FitAddon } from 'xterm-addon-fit';
import { ISearchOptions, SearchAddon } from 'xterm-addon-search';
import type { WebglAddon as WebglAddonType } from 'xterm-addon-webgl';

import { Injectable, Autowired, Injector, INJECTOR_TOKEN } from '@opensumi/di';
import { IClipboardService } from '@opensumi/ide-core-browser';
import { Disposable, isSafari } from '@opensumi/ide-core-common';
import { MessageService } from '@opensumi/ide-overlay/lib/browser/message.service';
import { WorkbenchThemeService } from '@opensumi/ide-theme/lib/browser/workbench.theme.service';
import { PANEL_BACKGROUND } from '@opensumi/ide-theme/lib/common/color-registry';
import { IThemeService } from '@opensumi/ide-theme/lib/common/theme.service';

import { SupportedOptions } from '../common/preference';
import { IXTerm } from '../common/xterm';

import styles from './component/terminal.module.less';
import {
  TERMINAL_BACKGROUND_COLOR,
  TERMINAL_FIND_MATCH_BACKGROUND_COLOR,
  TERMINAL_FIND_MATCH_BORDER_COLOR,
  TERMINAL_FIND_MATCH_HIGHLIGHT_BACKGROUND_COLOR,
  TERMINAL_FIND_MATCH_HIGHLIGHT_BORDER_COLOR,
  TERMINAL_OVERVIEW_RULER_CURSOR_FOREGROUND_COLOR,
  TERMINAL_OVERVIEW_RULER_FIND_MATCH_FOREGROUND_COLOR,
} from './terminal.color';

export interface XTermOptions {
  cwd?: string;
  // 要传给 xterm 的参数和一些我们自己的参数（如 copyOnSelection）
  // 现在混在一起，也不太影响使用
  xtermOptions: SupportedOptions & ITerminalOptions;
}

@Injectable({ multiple: true })
export class XTerm extends Disposable implements IXTerm {
  @Autowired(INJECTOR_TOKEN)
  protected readonly injector: Injector;

  @Autowired(MessageService)
  protected messageService: MessageService;

  @Autowired(IClipboardService)
  protected clipboardService: IClipboardService;

  @Autowired(IThemeService)
  protected themeService: WorkbenchThemeService;

  container: HTMLDivElement;

  raw: Terminal;

  xtermOptions: ITerminalOptions & SupportedOptions;

  /** addons */
  private _fitAddon: FitAddon;
  private _searchAddon: SearchAddon;
  private _webglAddon?: WebglAddonType;
  private _canvasAddon?: CanvasAddonType;
  /** end */

  constructor(public options: XTermOptions) {
    super();
    this.container = document.createElement('div');
    this.container.className = styles.terminalInstance;

    this.xtermOptions = options.xtermOptions;

    this.raw = new Terminal({
      allowProposedApi: true,
      ...this.xtermOptions,
    });
    this._prepareAddons();
    this.raw.onSelectionChange(this.onSelectionChange.bind(this));
  }

  private loadWebGLAddon() {
    return !isSafari;
  }

  private async enableCanvasRenderer() {
    try {
      if (!this._canvasAddon) {
        // @ts-ignore
        this._canvasAddon = new (await import('xterm-addon-canvas')).CanvasAddon();
      }

      this.addDispose(this._canvasAddon);
      this.raw.loadAddon(this._canvasAddon);

      if (this._webglAddon) {
        this._webglAddon.dispose();
        this._webglAddon = undefined;
      }
    } catch (err) {
      // ignore
    }
  }

  private async enableWebglRenderer() {
    try {
      if (!this._webglAddon) {
        // @ts-ignore
        this._webglAddon = new (await import('xterm-addon-webgl')).WebglAddon();
      }

      this.addDispose(this._webglAddon);
      this.addDispose(
        this._webglAddon.onContextLoss(() => {
          // @ts-ignore
          this.raw.options.rendererType = 'dom';
        }),
      );
      this.raw.loadAddon(this._webglAddon);
      if (this._canvasAddon) {
        this._canvasAddon.dispose();
        this._canvasAddon = undefined;
      }
    } catch (err) {
      await this.enableCanvasRenderer();
    }
  }

  private async _prepareAddons() {
    this._searchAddon = new SearchAddon();
    this._fitAddon = new FitAddon();

    this.addDispose([this._searchAddon, this._fitAddon]);

    this.raw.loadAddon(this._searchAddon);
    this.raw.loadAddon(this._fitAddon);
  }

  updateTheme(theme: ITheme | undefined) {
    if (theme) {
      this.raw.options.theme = theme;
      this.xtermOptions = {
        ...this.xtermOptions,
        theme,
      };
    }
  }

  updatePreferences(options: SupportedOptions) {
    this.xtermOptions = {
      ...this.xtermOptions,
      ...options,
    };
  }

  private getFindColors() {
    const theme = this.themeService.getCurrentThemeSync();
    // Theme color names align with monaco/vscode whereas xterm.js has some different naming.
    // The mapping is as follows:
    // - findMatch -> activeMatch
    // - findMatchHighlight -> match
    const terminalBackground = theme.getColor(TERMINAL_BACKGROUND_COLOR) || theme.getColor(PANEL_BACKGROUND);
    const findMatchBackground = theme.getColor(TERMINAL_FIND_MATCH_BACKGROUND_COLOR);
    const findMatchBorder = theme.getColor(TERMINAL_FIND_MATCH_BORDER_COLOR);
    const findMatchOverviewRuler = theme.getColor(TERMINAL_OVERVIEW_RULER_CURSOR_FOREGROUND_COLOR);
    const findMatchHighlightBackground = theme.getColor(TERMINAL_FIND_MATCH_HIGHLIGHT_BACKGROUND_COLOR);
    const findMatchHighlightBorder = theme.getColor(TERMINAL_FIND_MATCH_HIGHLIGHT_BORDER_COLOR);
    const findMatchHighlightOverviewRuler = theme.getColor(TERMINAL_OVERVIEW_RULER_FIND_MATCH_FOREGROUND_COLOR);

    return {
      activeMatchBackground: findMatchBackground?.toString(),
      activeMatchBorder: findMatchBorder?.toString() || 'transparent',
      activeMatchColorOverviewRuler: findMatchOverviewRuler?.toString() || 'transparent',
      matchBackground: terminalBackground
        ? findMatchHighlightBackground?.blend(terminalBackground).toString()
        : undefined,
      matchBorder: findMatchHighlightBorder?.toString() || 'transparent',
      matchOverviewRuler: findMatchHighlightOverviewRuler?.toString() || 'transparent',
    };
  }

  findNext(text: string) {
    const options: ISearchOptions = {
      decorations: this.getFindColors(),
    };
    return this._searchAddon.findNext(text, options);
  }

  closeSearch() {
    this._searchAddon.clearDecorations();
  }

  open() {
    this.raw.open(this.container);
    if (this.loadWebGLAddon()) {
      this.enableWebglRenderer();
    }
  }

  fit() {
    this._fitAddon.fit();
  }

  async onSelectionChange() {
    if (this.xtermOptions?.copyOnSelection) {
      if (this.raw.hasSelection()) {
        await this.copySelection();
      }
    }
  }

  async copySelection() {
    if (this.raw.hasSelection()) {
      await this.clipboardService.writeText(this.raw.getSelection());
    } else {
      this.messageService.warning('The terminal has no selection to copy');
    }
  }

  dispose() {
    this.raw.dispose();
    this.container.remove();
  }
}
