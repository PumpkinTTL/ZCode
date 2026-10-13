import { accessSync, constants, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { chromium } from "playwright-core";
import { afterEach, beforeAll, expect, it } from "vitest";
// Polaris：本包的 package.json 只声明 @zcode/core 与 @zcode/node-repl-host（合并前已按
// 「零使用依赖清扫」裁掉 adapters/bootstrap/shared/playwright-core 的声明），所以这几项走
// 源码相对路径——与本文件既有的 `../../bootstrap/...` 同一约定。声明的两个包照旧走包名。
import {
  createManagedCdpBrowserRuntime,
  resolveInstalledBrowserExecutable,
} from "../../adapters/src/browser/index.js";
import {
  NODE_REPL_BROWSER_BROKER_SOCKET_ENV,
  NODE_REPL_BROWSER_BROKER_TOKEN_ENV,
} from "../../../../../packages/shared/src/browser-use/nodeReplBroker.js";
import {
  createNodeReplBrowserBroker,
  type NodeReplBrowserBroker,
} from "../../bootstrap/src/app/node-repl-browser-broker.js";
import { buildBrowserUsePluginBundles } from "../scripts/build.mjs";
import type { NodeReplMcpRuntime } from "@zcode/node-repl-host";

const required = process.env.ZCODE_HEADLESS_BROWSER_E2E_REQUIRED === "1";
const executablePath = discoverBrowserExecutable();
const realBrowserTest = executablePath || required ? it : it.skip;

const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));
const BROWSER_CLIENT_BUNDLE = fileURLToPath(new URL("../scripts/browser-client.mjs", import.meta.url));

// 链路要 import 构建产物 scripts/browser-client.mjs（.gitignore 忽略、由 build.mjs 生成）。
// 上游靠 `test:browser-headless` 先 build 再 vitest 才成立；直接跑 vitest 时产物缺席，链路会以
// 「Cannot find module ... browser-client.mjs」失败。这里在用例前补建一次，让测试自带前置条件。
beforeAll(async () => {
  if (!existsSync(BROWSER_CLIENT_BUNDLE)) {
    await buildBrowserUsePluginBundles({ packageRoot: PLUGIN_ROOT });
  }
}, 120_000);

const logger = {
  child: () => logger,
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

let browserRuntime: ReturnType<typeof createManagedCdpBrowserRuntime> | undefined;
let broker: NodeReplBrowserBroker | undefined;
let client: Client | undefined;
let mcpRuntime: NodeReplMcpRuntime | undefined;
let fixtureServer: Server | undefined;
const originalEnv = new Map<string, string | undefined>();

afterEach(async () => {
  await client?.close().catch(() => undefined);
  mcpRuntime?.dispose();
  await broker?.close();
  await browserRuntime?.close();
  if (fixtureServer) await new Promise<void>((resolve) => fixtureServer?.close(() => resolve()));
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originalEnv.clear();
  browserRuntime = undefined;
  broker = undefined;
  client = undefined;
  mcpRuntime = undefined;
  fixtureServer = undefined;
});

realBrowserTest(
  "drives real headless Chromium through MCP js, browser-client, broker, and BrowserControlPort",
  async () => {
    const pluginRoot = fileURLToPath(new URL("..", import.meta.url));
    fixtureServer = createFixtureServer();
    const fixtureUrl = await listen(fixtureServer);
    browserRuntime = createManagedCdpBrowserRuntime({ executablePath });
    broker = createNodeReplBrowserBroker({
      browserControlPort: browserRuntime.browserControlPort,
      logger,
    });
    await broker.ready;

    setEnv("ZCODE_PLUGIN_ROOT", pluginRoot);
    setEnv(NODE_REPL_BROWSER_BROKER_SOCKET_ENV, broker.socketPath);
    setEnv(NODE_REPL_BROWSER_BROKER_TOKEN_ENV, broker.token);
    setEnv("DISPLAY", undefined);

    const mcpModule = await import("@zcode/node-repl-host");
    mcpRuntime = mcpModule.createNodeReplMcpRuntime({
      executeJs: mcpModule.createInProcessNodeReplExecutor(),
    });
    client = new Client({ name: "headless-browser-e2e", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpRuntime.server.connect(serverTransport);
    await client.connect(clientTransport);

    const bootstrap = await client.callTool({
      name: "js",
      arguments: {
        code: [
          "if (globalThis.agent?.browsers == null) {",
          "  const { join } = await import('node:path');",
          "  const { pathToFileURL } = await import('node:url');",
          "  const root = process.env.ZCODE_PLUGIN_ROOT;",
          "  if (!root) throw new Error('missing browser plugin root');",
          "  const clientUrl = pathToFileURL(join(root, 'scripts', 'browser-client.mjs')).href;",
          "  const { setupBrowserRuntime } = await import(clientUrl);",
          "  await setupBrowserRuntime({ globals: globalThis });",
          "}",
          "globalThis.browser = await agent.browsers.get('cdp');",
          "await agent.browsers.list();",
        ].join("\n"),
      },
      _meta: requestMeta("bootstrap"),
    });
    expect(bootstrap.isError, textContent(bootstrap)).not.toBe(true);
    expect(textContent(bootstrap)).toContain('"type": "cdp"');

    const interaction = await client.callTool({
      name: "js",
      arguments: {
        code: [
          "const { join } = await import('node:path');",
          "const { pathToFileURL } = await import('node:url');",
          "const root = process.env.ZCODE_PLUGIN_ROOT;",
          "if (!root) throw new Error('missing browser plugin root');",
          "const clientUrl = pathToFileURL(join(root, 'scripts', 'browser-client.mjs')).href;",
          "const { setupBrowserRuntime } = await import(clientUrl);",
          "await setupBrowserRuntime({ globals: globalThis });",
          "const browser = await agent.browsers.get('cdp');",
          "globalThis.tab = await browser.tabs.new();",
          `await tab.goto(${JSON.stringify(fixtureUrl)});`,
          "await tab.setViewportSize({ width: 375, height: 667 });",
          "const before = await tab.playwright.domSnapshot();",
          "const nameInput = tab.playwright.getByLabel('Name');",
          "await nameInput.fill('ZCode');",
          "await tab.playwright.getByRole('button', { name: 'Submit' }).click();",
          "({",
          "  beforeHasForm: before.includes('Name') && before.includes('Submit'),",
          "  inputValue: await nameInput.getAttribute('value'),",
          "  status: await tab.playwright.getByRole('status').innerText(),",
          "  viewport: tab.viewportSize(),",
          "  actualViewport: await tab.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),",
          "  screenshotBytes: (await tab.screenshot()).length,",
          "  tabs: await browser.tabs.list(),",
          "});",
        ].join("\n"),
      },
      _meta: requestMeta("interaction"),
    });
    const output = textContent(interaction);
    expect(interaction.isError).not.toBe(true);
    expect(output).toContain('"beforeHasForm": true');
    expect(output).toContain('"inputValue": "ZCode"');
    expect(output).toContain('"status": "Submitted ZCode"');
    expect(output).toMatch(/"viewport":\s*\{\s*"width": 375,\s*"height": 667/u);
    expect(output).toMatch(/"actualViewport":\s*\{\s*"width": 375,\s*"height": 667/u);
    expect(output).toMatch(/"tabs":\s*\[[\s\S]*"viewport":\s*\{\s*"width": 375,\s*"height": 667/u);
    expect(output).toMatch(/"screenshotBytes": [1-9][0-9]*/u);
    expect(output).toContain(fixtureUrl);
  },
  30_000,
);

function requestMeta(turnId: string) {
  return {
    "com.zcode/request-context": {
      runtime_scope: "main" as const,
      session_id: "headless-e2e-session",
      turn_id: turnId,
    },
  };
}

function discoverBrowserExecutable(): string | undefined {
  try {
    const resolved = resolveInstalledBrowserExecutable(
      { chromium },
      { executablePath: process.env.ZCODE_HEADLESS_BROWSER_E2E_EXECUTABLE },
    );
    if (process.platform !== "win32") accessSync(resolved, constants.X_OK);
    return resolved;
  } catch {
    return undefined;
  }
}

function createFixtureServer(): Server {
  return createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html><body>
      <label>Name <input aria-label="Name" /></label>
      <button type="button">Submit</button>
      <p role="status">Waiting</p>
      <script>
        document.querySelector('input').addEventListener('input', (event) => {
          event.target.setAttribute('value', event.target.value);
        });
        document.querySelector('button').addEventListener('click', () => {
          document.querySelector('[role=status]').textContent =
            'Submitted ' + document.querySelector('input').value;
        });
      </script>
    </body></html>`);
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP fixture did not bind TCP");
  return `http://127.0.0.1:${address.port}/`;
}

function textContent(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n");
}

function setEnv(key: string, value: string | undefined): void {
  if (!originalEnv.has(key)) originalEnv.set(key, process.env[key]);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
