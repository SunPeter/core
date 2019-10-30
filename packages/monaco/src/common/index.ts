export * from '@ali/ide-core-browser/lib/monaco';

export interface LanguagesContribution {
  id: string;
  // 扩展名
  extensions: string[];
  // 语言别名
  aliases?: string[];
  // 正则表达式字符串 如 "^#!/.*\\bpython[0-9.-]*\\b"
  firstLine?: string;
  // 配置文件路径
  configuration?: string;
  // 如["text/css"]
  mimetypes?: string[];
  filenames?: string[];
  filenamePatterns?: string[];
}

export interface ScopeMap {
  [scopeName: string]: string;
}

export interface GrammarsContribution {
  language?: string;
  scopeName: string;
  path: string;
  embeddedLanguages?: ScopeMap;
  tokenTypes?: ScopeMap;
  injectTo?: string[];
}

// TODO 这些声明最后都要聚拢到插件声明
export interface FoldingMarkers {
  start: string;
  end: string;
}

export interface FoldingRules {
  offSide?: boolean;
  markers?: FoldingMarkers;
}

export interface IndentationRules {
  increaseIndentPattern: string;
  decreaseIndentPattern: string;
  unIndentedLinePattern?: string;
  indentNextLinePattern?: string;
}

export interface ILanguageConfiguration {
  comments?: CommentRule;
  brackets?: CharacterPair[];
  autoClosingPairs?: Array<CharacterPair | IAutoClosingPairConditional>;
  surroundingPairs?: Array<CharacterPair | IAutoClosingPair>;
  wordPattern?: string | IRegExp;
  indentationRules?: IIndentationRules;
  folding?: FoldingRules;
  autoCloseBefore?: string;
}

/**
 * Describes how comments for a language work.
 */
export interface CommentRule {
  /**
	 * The line comment token, like `// this is a comment`
	 */
  lineComment?: string | null;
  /**
	 * The block comment character pair, like `/* block comment *&#47;`
	 */
  blockComment?: CharacterPair | null;
}

/**
 * A tuple of two characters, like a pair of
 * opening and closing brackets.
 */
export type CharacterPair = [string, string];

export interface IAutoClosingPair {
  open: string;
  close: string;
}

export interface IAutoClosingPairConditional extends IAutoClosingPair {
  notIn?: string[];
}

interface IRegExp {
  pattern: string;
  flags?: string;
}

interface IIndentationRules {
  decreaseIndentPattern: string | IRegExp;
  increaseIndentPattern: string | IRegExp;
  indentNextLinePattern?: string | IRegExp;
  unIndentedLinePattern?: string | IRegExp;
}
