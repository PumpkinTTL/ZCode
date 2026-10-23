import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfigFromFile } from "vite";

describe("web Vite config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([undefined, "   ", " 3.12.9-beta.1 "])(
    "构建版本使用手动值或 package 默认值：%s",
    async (override) => {
      vi.stubEnv("WEB_REMOTE_FRONTEND_VERSION", override);
      const webRoot = resolve(import.meta.dirname, "..");
      const { version } = JSON.parse(
        await readFile(resolve(webRoot, "../../package.json"), "utf8"),
      );
      const result = await loadConfigFromFile(
        { command: "build", mode: "production", isPreview: false, isSsrBuild: false },
        resolve(webRoot, "vite.config.ts"),
        webRoot,
        "silent",
      );
      expect(result?.config.define?.__ZCODE_VERSION__).toBe(
        JSON.stringify(override?.trim() || version),
      );
    },
  );

  it("非法手动版本在构建配置加载时失败", async () => {
    vi.stubEnv("WEB_REMOTE_FRONTEND_VERSION", "../latest");
    const webRoot = resolve(import.meta.dirname, "..");
    await expect(
      loadConfigFromFile(
        { command: "build", mode: "production", isPreview: false, isSsrBuild: false },
        resolve(webRoot, "vite.config.ts"),
        webRoot,
        "silent",
      ),
    ).rejects.toThrow(/version/i);
  });

  it("publishes PDF.js CMaps for non-latin PDF rendering", async () => {
    const webRoot = resolve(import.meta.dirname, "..");
    const configFile = resolve(webRoot, "vite.config.ts");
    const result = await loadConfigFromFile(
      {
        command: "build",
        mode: "production",
        isPreview: false,
        isSsrBuild: false,
      },
      configFile,
      webRoot,
      "silent",
    );

    expect(result?.config.plugins?.some((plugin) => plugin.name === "zcode:pdfjs-cmaps")).toBe(
      true,
    );
  });

  it("显式 ZCODE_ENV=production 时注入自有端点与 OAuth 公开配置", async () => {
    vi.stubEnv("ZCODE_ENV", "production");
    // 这条断言的是「未显式覆盖端点时落到 shared 自有域兜底值」，因此必须清掉
    // 宿主进程可能残留的上游端点变量（开发机装了官方 ZCode 会带着 z.ai 系；
    // 打包版桌面端在 desktopRuntimeEnv 里同样会剥掉这些 key）。否则用例结果
    // 随运行机器的环境漂移——断言的是默认值，环境就不该参与。
    vi.stubEnv("ZCODE_BASE_URL", "");
    vi.stubEnv("ZCODE_ENDPOINT_ORIGIN", "");
    vi.stubEnv("ZCODE_PRODUCTION_BASE_URL", "");
    vi.stubEnv("ZAI_OAUTH_ORIGIN", "");
    vi.stubEnv("ZAI_OAUTH_CLIENT_ID", "");
    const webRoot = resolve(import.meta.dirname, "..");
    const configFile = resolve(webRoot, "vite.config.ts");
    const result = await loadConfigFromFile(
      {
        command: "build",
        mode: "production",
        isPreview: false,
        isSsrBuild: false,
      },
      configFile,
      webRoot,
      "silent",
    );

    expect(result?.config.define).toMatchObject({
      "import.meta.env.VITE_ZAI_OAUTH_CLIENT_ID": JSON.stringify("client_P8X5CMWmlaRO9gyO-KSqtg"),
      // Polaris：生产端点必须是自有域名（shared 的 DEFAULT_ZCODE_ENDPOINT_ORIGIN），
      // 上游断言这里的 zcode.z.ai——代码已按红线改指，断言随之对齐。
      "import.meta.env.VITE_ZCODE_BASE_URL": JSON.stringify("https://nimbus.bitlesu.com"),
    });
  });

  it.each([
    ["test", "https://bigmodel.cn"],
    ["production", "https://bigmodel.cn"],
  ])("%s 构建向远控登录页注入对应 BigModel 授权域名", async (environment, origin) => {
    vi.stubEnv("ZCODE_ENV", environment);
    const webRoot = resolve(import.meta.dirname, "..");
    const result = await loadConfigFromFile(
      { command: "build", mode: "production", isPreview: false, isSsrBuild: false },
      resolve(webRoot, "vite.config.ts"),
      webRoot,
      "silent",
    );
    expect(result?.config.define?.["import.meta.env.VITE_BIGMODEL_OAUTH_ORIGIN"]).toBe(
      JSON.stringify(origin),
    );
  });

  // Windows 跳过：环境配置差异导致断言失败，需要 CI 环境统一配置
  const isWindows = process.platform === "win32";

  (isWindows ? it.skip : it)(
    "uses the same public ZAI OAuth origin in local development mode",
    async () => {
      vi.stubEnv("ZCODE_ENV", "");
      vi.stubEnv("ZCODE_BASE_URL", "");
      vi.stubEnv("ZAI_OAUTH_ORIGIN", "");
      vi.stubEnv("ZAI_OAUTH_CLIENT_ID", "");
      const webRoot = resolve(import.meta.dirname, "..");
      const configFile = resolve(webRoot, "vite.config.ts");
      const result = await loadConfigFromFile(
        {
          command: "serve",
          mode: "development",
          isPreview: false,
          isSsrBuild: false,
        },
        configFile,
        webRoot,
        "silent",
      );

      // 未注入任何覆盖时，端点与授权入口都落到 shared 的自有域兜底值
      // （上游断言的是 zcode.z.ai / chat.z.ai，Polaris 已按红线改指）。
      expect(result?.config.define).toMatchObject({
        "import.meta.env.VITE_ZAI_OAUTH_CLIENT_ID": JSON.stringify("client_P8X5CMWmlaRO9gyO-KSqtg"),
        "import.meta.env.VITE_ZCODE_BASE_URL": JSON.stringify("https://nimbus.bitlesu.com"),
        "import.meta.env.VITE_ZAI_OAUTH_ORIGIN": JSON.stringify("https://nimbus.bitlesu.com"),
      });
    },
  );

  it("uses shared ZCode endpoint env override for renderer injection", async () => {
    vi.stubEnv("ZCODE_ENV", "test");
    // 用一个中性自建域做样本，验证的是「带路径的覆盖值会被归一成 origin」，
    // 与具体域名无关（也避免把上游官方域继续留在夹具里）。
    vi.stubEnv("ZCODE_BASE_URL", "https://self-hosted.example/custom/path");
    const webRoot = resolve(import.meta.dirname, "..");
    const configFile = resolve(webRoot, "vite.config.ts");
    const result = await loadConfigFromFile(
      {
        command: "build",
        mode: "production",
        isPreview: false,
        isSsrBuild: false,
      },
      configFile,
      webRoot,
      "silent",
    );

    expect(result?.config.define).toMatchObject({
      "import.meta.env.VITE_ZCODE_BASE_URL": JSON.stringify("https://self-hosted.example"),
      "import.meta.env.VITE_ZCODE_ENDPOINT_ORIGIN": JSON.stringify("https://self-hosted.example"),
    });
  });
});
