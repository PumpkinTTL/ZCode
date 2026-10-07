import type { ProviderConfigLayerSnapshot, ProviderSource } from "@zcode/provider";
import {
  normalizeZCodeBuiltinEndpointOrigin,
  resolveZCodeBuiltinCachePaths,
} from "./zcode-builtin-cache-paths.js";
import { NodeZCodeBuiltinProviderConfigSource } from "./zcode-builtin-provider-config-source.js";
import {
  ZCodeBuiltinRemoteSynchronizer,
  type ZCodeBuiltinRefreshResult,
  type ZCodeBuiltinRemoteSynchronizerOptions,
} from "./zcode-builtin-remote-synchronizer.js";

export interface EndpointScopedZCodeBuiltinSourceOptions {
  readonly bundledFilePath: string;
  readonly environmentConfigRoot: string;
  readonly platform: string;
  readonly appVersion: string;
  readonly resolveEndpointOrigin: () => string | Promise<string>;
  /**
   * 远端发布拉取（上游 CDN 分发通道）。**Polaris 已砍**：内置配置以仓库 bundled 为
   * 唯一事实源，不再从任何远端拉取——缺省不传，源只做本地物化（active 缓存）。
   * 保留类型形参是为了让「上游形态」的调用方仍可编译（传了才建同步器）。
   */
  readonly fetchRelease?: ZCodeBuiltinRemoteSynchronizerOptions["fetchRelease"];
  readonly onRefreshResult?: ZCodeBuiltinRemoteSynchronizerOptions["onRefreshResult"];
  readonly watch?: boolean;
}

/**
 * 让 Environment 的 ZCode 控制面 Endpoint 同时决定 Active/LKG 与刷新控制路径。
 * Endpoint 切换只替换当前 Source，不读取上一 Endpoint 的缓存。
 */
export class EndpointScopedZCodeBuiltinSource implements ProviderSource<ProviderConfigLayerSnapshot> {
  readonly #options: EndpointScopedZCodeBuiltinSourceOptions;
  readonly #listeners = new Set<(reason: string) => void>();
  #current: CurrentEndpointSource | null = null;
  #ensureInFlight: Promise<CurrentEndpointSource> | null = null;
  #disposed = false;

  constructor(options: EndpointScopedZCodeBuiltinSourceOptions) {
    this.#options = options;
  }

  async read(): Promise<ProviderConfigLayerSnapshot> {
    return (await this.#ensureCurrent()).source.read();
  }

  onDidChange(listener: (reason: string) => void): () => void {
    this.#assertNotDisposed();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async refresh(options?: { readonly force?: boolean }): Promise<ZCodeBuiltinRefreshResult> {
    // 远端同步已砍：无 fetchRelease 时刷新是显式 no-op（"skipped"），绝不出网。
    return (await this.#ensureCurrent()).synchronizer?.refresh(options) ?? "skipped";
  }

  /** 远端同步是否启用（Polaris 已砍=false）：宿主据此决定是否建周期检查定时器。 */
  get remoteEnabled(): boolean {
    return this.#options.fetchRelease !== undefined;
  }

  /** 返回当前 Environment Endpoint 对应、已完成物化的 Active Config 路径。 */
  async resolveActiveFilePath(): Promise<string> {
    return (await this.#ensureCurrent()).activeFilePath;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#current?.dispose();
    this.#current = null;
    this.#listeners.clear();
  }

  async #ensureCurrent(): Promise<CurrentEndpointSource> {
    this.#assertNotDisposed();
    if (this.#ensureInFlight) return this.#ensureInFlight;
    const ensure = this.#resolveCurrent().finally(() => {
      if (this.#ensureInFlight === ensure) this.#ensureInFlight = null;
    });
    this.#ensureInFlight = ensure;
    return ensure;
  }

  async #resolveCurrent(): Promise<CurrentEndpointSource> {
    const endpointOrigin = normalizeZCodeBuiltinEndpointOrigin(
      await this.#options.resolveEndpointOrigin(),
    );
    const paths = resolveZCodeBuiltinCachePaths({
      environmentConfigRoot: this.#options.environmentConfigRoot,
      platform: this.#options.platform,
      appVersion: this.#options.appVersion,
      zcodeEndpointOrigin: endpointOrigin,
    });
    if (this.#current?.activeFilePath === paths.activeFilePath) return this.#current;

    const source = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: this.#options.bundledFilePath,
      activeFilePath: paths.activeFilePath,
      watch: this.#options.watch,
    });
    const sourceDispose = source.onDidChange((reason) => this.#emit(reason));
    // Polaris：未提供 fetchRelease = 远端同步已砍，不建同步器（control file 也不再写）。
    const synchronizer = this.#options.fetchRelease
      ? new ZCodeBuiltinRemoteSynchronizer({
          source,
          controlFilePath: paths.controlFilePath,
          resolveEndpointKey: async () =>
            normalizeZCodeBuiltinEndpointOrigin(await this.#options.resolveEndpointOrigin()),
          fetchRelease: this.#options.fetchRelease,
          onRefreshResult: this.#options.onRefreshResult,
        })
      : null;
    try {
      await source.read();
      this.#assertNotDisposed();
    } catch (error) {
      sourceDispose();
      synchronizer?.dispose();
      source.dispose();
      throw error;
    }

    const previous = this.#current;
    const current = new CurrentEndpointSource(
      paths.activeFilePath,
      source,
      synchronizer,
      sourceDispose,
    );
    this.#current = current;
    previous?.dispose();
    if (previous) this.#emit("endpoint-changed");
    return current;
  }

  #emit(reason: string): void {
    if (this.#disposed) return;
    for (const listener of this.#listeners) listener(reason);
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new Error("EndpointScopedZCodeBuiltinSource 已 dispose");
  }
}

class CurrentEndpointSource {
  constructor(
    readonly activeFilePath: string,
    readonly source: NodeZCodeBuiltinProviderConfigSource,
    readonly synchronizer: ZCodeBuiltinRemoteSynchronizer | null,
    readonly sourceDispose: () => void,
  ) {}

  dispose(): void {
    this.sourceDispose();
    this.synchronizer?.dispose();
    this.source.dispose();
  }
}
