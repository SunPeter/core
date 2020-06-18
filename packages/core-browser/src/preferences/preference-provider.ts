import { Injectable } from '@ali/common-di';
import { IDisposable, DisposableCollection, Emitter, Event, URI, Deferred, JSONUtils, JSONValue, Resource } from '@ali/ide-core-common';
import { PreferenceScope } from '@ali/ide-core-common/lib/preferences/preference-scope';
import { getExternalPreferenceProvider, getAllExternalProviders } from './early-preferences';
export interface IResolvedPreferences {
  default: {[key: string]: any};
  languageSpecific: {
    [languageId: string]: {[key: string]: any},
  };
}
export interface PreferenceProviderDataChange {
  readonly preferenceName: string;
  readonly newValue?: any;
  readonly oldValue?: any;
  readonly scope: PreferenceScope;
  readonly domain?: string[];
}

export interface PreferenceProviderDataChanges {
  default: {
    [preferenceName: string]: PreferenceProviderDataChange;
  };
  languageSpecific: ILanguagePreferenceProviderDataChanges;
}

export interface ILanguagePreferenceProviderDataChanges {
  [languageId: string]: {
    [preferenceName: string]: PreferenceProviderDataChange;
  };
}

export interface PreferenceResolveResult<T> {
  configUri?: URI;
  value?: T;
  scope?: PreferenceScope;
  // 是否存在来自针对语言的设置
  languageSpecific?: boolean;
}

function transformReverse(delegates: {[delegated: string]: {
  delegateTo: string,
  transform?: (delegateValue: any) => any,
}}): {[delegated: string]: {
  delegated: string,
  delegateTo: string,
  transform?: (delegateValue: any) => any,
}} {
  const res = {};
  for (const key of Object.keys(delegates)) {
    res[delegates[key].delegateTo] = {
      delegated: key,
      ...delegates[key],
    };
  }
  return res;
}

@Injectable()
export abstract class PreferenceProvider implements IDisposable {

  public readonly name: string;

  private readonly onDidPreferencesChangedEmitter = new Emitter<PreferenceProviderDataChanges>();
  public readonly onDidPreferencesChanged: Event<PreferenceProviderDataChanges> = this.onDidPreferencesChangedEmitter.event;

  protected readonly toDispose = new DisposableCollection();

  protected readonly _ready = new Deferred<void>();

  public resource: Promise<Resource>;

  private _scope: PreferenceScope;

  // preferenceDelegate 原则, delegate值优先，不改变原有 delegateTo 的行为
  // 1. 当修改 delegate 设置值发生改变时，同时发出 delegate 和 delegateTo 的 change 事件。
  // 2. 当尝试获取 delegateTo 的值时，会尝试先获取 delegate 的值，如果没有值，继续原来的逻辑。
  // 3. 当尝试修改 delegateTo 的值时，删除 delegate 的值
  // 4. 当尝试获取 delegate 的值时，如果 delegate 没有值， 尝试获取 delegateTo 的值
  // 5. schema 只会检测改变后 delegatedTo 的值
  // 6. 不对语言特定的设置生效
  static PreferenceDelegates: {[delegated: string]: {
    delegateTo: string,
    transform?: (delegatedValue: any) => any,
    transformFrom?: (delegatedToValue: any) => any,
  }} = {
    'workbench.colorTheme': {
      delegateTo: 'general.theme',
    },
  };

  static PreferenceDelegatesReverse: {[delegated: string]: {
    delegated: string,
    delegateTo: string,
    transform?: (delegatedValue: any) => any,
    transformFrom?: (delegatedToValue: any) => any,
  }} = transformReverse(PreferenceProvider.PreferenceDelegates);

  constructor() {
    this.toDispose.push(this.onDidPreferencesChangedEmitter);
  }

  public asScope(scope: PreferenceScope) {
    if (this._scope) {
      return;
    }
    this._scope = scope;
    // 如果 external provider 有监听器，监听
    getAllExternalProviders().forEach(([preferenceName, provider]) => {
      if (provider.onDidChange) {
        provider.onDidChange((e) => {
          if (e.scope === this._scope) {
            this.emitPreferencesChangedEvent([{
              preferenceName,
              scope: e.scope,
              newValue: e.newValue,
              oldValue: e.oldValue,
            }], true);
          }
        });
      }
    });
  }

  public dispose(): void {
    this.toDispose.dispose();
  }

  /**
   * 处理事件监听中接收到的Event数据对象
   * 以便后续接收到数据后能确认来自那个配置项的值
   */
  protected emitPreferencesChangedEvent(changes: PreferenceProviderDataChanges | PreferenceProviderDataChange[], noFilterExternal?: boolean): void {
    let prefChanges: PreferenceProviderDataChanges;
    if (Array.isArray(changes)) {
      prefChanges =  {default: {}, languageSpecific: {}};
      for (const change of changes) {
        prefChanges.default[change.preferenceName] = change;
      }
    } else {
      prefChanges = changes;
    }
    if (this._scope) {
      // 只对scope preference provider做处理
      for (const preferenceName of Object.keys(prefChanges.default)) {
        const change = prefChanges.default[preferenceName];
        if (PreferenceProvider.PreferenceDelegates[change.preferenceName]) {
          const delegate = PreferenceProvider.PreferenceDelegates[change.preferenceName];
          if (this.get(delegate.delegateTo) !== undefined && this.get(change.preferenceName) === undefined) {
            // 这种情况不发出 delegateTo 的改变
          } else {
            prefChanges.default[delegate.delegateTo] = {
              ...change,
              oldValue: undefined,
              newValue: change.newValue !== undefined ? (delegate.transform ? delegate.transform(change.newValue) : change.newValue) : undefined,
              preferenceName: delegate.delegateTo,
            };
          }
        }
        if (!noFilterExternal && !!getExternalPreferenceProvider(preferenceName)) {
          // 过滤externalProvider管理的preference
          delete prefChanges.default[preferenceName];
        }
      }
    }
    this.onDidPreferencesChangedEmitter.fire(prefChanges);
  }

  // @final 不要 override 这个
  public get<T>(preferenceName: string, resourceUri?: string, language?: string): T | undefined {
    if (PreferenceProvider.PreferenceDelegatesReverse[preferenceName]) {
      const res = this.getDelegateToValueFromDelegated(preferenceName);
      if (res !== undefined) {
        return res;
      }
    }
    const value = this.getWithoutDelegate<T>(preferenceName, resourceUri, language);
    if (value === undefined && PreferenceProvider.PreferenceDelegates[preferenceName]) {
      return this.getDelegatedValueFromDelegateTo(preferenceName);
    } else {
      return value;
    }
  }

  public getWithoutDelegate<T>(preferenceName: string, resourceUri?: string, language?: string): T | undefined {
    if (this._scope) {
      const externalProvider = getExternalPreferenceProvider(preferenceName);
      if (externalProvider) {
        return externalProvider.get(this._scope);
      }
    }
    return this.doGet<T>(preferenceName, resourceUri, language);
  }

  // 从delegateTo 获取 delegated
  private getDelegatedValueFromDelegateTo(delegatedPreferenceName: string) {
    const delegate = PreferenceProvider.PreferenceDelegates[delegatedPreferenceName];
    const value = this.getWithoutDelegate(delegate!.delegateTo);
    if (delegate.transformFrom) {
      return delegate.transformFrom(value);
    } else {
      return value;
    }
  }

  // 从delegate 获取 delegateTo
  private getDelegateToValueFromDelegated(delegateToPreferenceName: string) {
    const delegate = PreferenceProvider.PreferenceDelegatesReverse[delegateToPreferenceName];
    const value = this.getWithoutDelegate(delegate!.delegated);
    if (delegate.transform) {
      return delegate.transform(value);
    } else {
      return value;
    }
  }

  protected doGet<T>(preferenceName: string, resourceUri?: string, language?: string): T | undefined {
    return this.doResolve<T>(preferenceName, resourceUri, language).value;
  }

  // @final 不要 override 这个
  public resolve<T>(preferenceName: string, resourceUri?: string, language?: string): PreferenceResolveResult<T> {
    if (PreferenceProvider.PreferenceDelegatesReverse[preferenceName]) {
      const res = this.getDelegateToValueFromDelegated(preferenceName);
      if (res !== undefined) {
        return {value: res, scope: this._scope}; // FIXME: 这里好像scope有点问题，暂时不影响
      }
    }
    if (this._scope) {
      const externalProvider = getExternalPreferenceProvider(preferenceName);
      if (externalProvider) {
        return {
          value: externalProvider.get(this._scope),
          scope: this._scope,
        };
      }
    }
    const res = this.doResolve<T>(preferenceName, resourceUri, language);
    if (res.value === undefined && PreferenceProvider.PreferenceDelegates[preferenceName]) {
      return { value: this.getDelegatedValueFromDelegateTo(preferenceName), scope: this._scope}; // FIXME: 这里好像scope有点问题，暂时不影响
    } else {
      return res;
    }
  }

  protected doResolve<T>(preferenceName: string, resourceUri?: string, language?: string): PreferenceResolveResult<T> {
    const value = this.getPreferences(resourceUri, language)[preferenceName];
    if (value !== undefined) {
      return {
        value,
        configUri: this.getConfigUri(resourceUri),
      };
    }
    return {};
  }

  public abstract getPreferences(resourceUri?: string, language?: string): { [p: string]: any };

  public abstract getLanguagePreferences(resourceUri?: string, language?: string): { [language: string]: {[p: string]: any} };

  public async setPreference(preferenceName: string, value: any, resourceUri?: string, language?: string): Promise<boolean> {
    if (PreferenceProvider.PreferenceDelegatesReverse[preferenceName]) {
      // 将delegate置空
      const delegate = PreferenceProvider.PreferenceDelegatesReverse[preferenceName];
      await this.setPreference(delegate.delegated, undefined);
    }
    if (this._scope) {
      const externalProvider = getExternalPreferenceProvider(preferenceName);
      if (externalProvider) {
        try {
          await externalProvider.set(value, this._scope);
          // 如果外部provider没有监听器，帮助他发送改变事件
          if (!externalProvider.onDidChange) {
            this.emitPreferencesChangedEvent([{
              preferenceName,
              scope: this._scope,
              newValue: externalProvider.get(this._scope),
            }], true);
          }
          return true;
        } catch (e) {
          return false;
        }
      }
    }
    return this.doSetPreference(preferenceName, value, resourceUri, language);
  }

  protected abstract doSetPreference(preferenceName: string, value: any, resourceUri?: string, language?: string): Promise<boolean>;

  /**
   * 返回promise，当 preference provider 已经可以提供配置时返回resolved
   */
  get ready() {
    return this._ready.promise;
  }

  /**
   * 默认返回undefined
   */
  public getDomain(): string[] | undefined {
    return undefined;
  }

  /**
   * 默认返回undefined
   */
  public getConfigUri(resourceUri?: string): URI | undefined {
    return undefined;
  }

  public static merge(source: JSONValue | undefined, target: JSONValue): JSONValue {
    if (source === undefined || !JSONUtils.isObject(source)) {
      return JSONUtils.deepCopy(target);
    }
    if (JSONUtils.isPrimitive(target)) {
      return {};
    }
    for (const key of Object.keys(target)) {
      const value = (target as any)[key];
      if (key in source) {
        if (JSONUtils.isObject(source[key]) && JSONUtils.isObject(value)) {
          this.merge(source[key], value);
          continue;
        }
      }
      source[key] = JSONUtils.deepCopy(value);
    }
    return source;
  }

}
