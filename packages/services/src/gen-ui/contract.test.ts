import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GEN_UI_STATIC_DOMAINS } from "@zcode/shared/gen-ui";
import { getGenUiOutputDirectory } from "@zcode/shared/node";
import type { PluginSandboxRegisterInput } from "@zcode/shared/mcp-apps";
import { IGenUiService } from "./contract.js";
import { exampleGenUiPrepare } from "./contract.example.js";
import { createGenUiService } from "./node.js";

// 该文件是模块契约测试（架构检查要求的 contract.test.ts 产物）：断言 CONTRACT.md 对外的
// 边界承诺（频道名、执行端读取范围、state 身份隔离、沙箱 provenance），
// 与 adapters/*.test.ts 的单点行为测试分工不同——这里走 node.ts 公开入口。

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function createFixture(options: { registerSandbox?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "gen-ui-contract-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const stateRoot = join(root, "state");
  const outputRoot = join(root, "user-data", "visualizations");
  const registrations: PluginSandboxRegisterInput[] = [];
  const service = createGenUiService({
    stateRoot,
    outputRoot,
    ...(options.registerSandbox === false
      ? {}
      : {
          registerSandbox: async (input) => {
            registrations.push(input);
            return {
              instance: input.instance,
              sandboxId: "sb-contract",
              initId: 1,
              partition: "gen-ui-contract",
              shellUrl: "zcode-sandbox://contract",
            };
          },
        }),
  });
  cleanups.push(() => service.dispose());
  return { root, outputRoot, stateRoot, registrations, service };
}

describe("gen-ui-service contract", () => {
  it("频道名与契约示例绑定同一个服务接口", () => {
    // node.ts 用 IGenUiService 描述符注册；改名会让宿主与消费端静默错频。
    expect(IGenUiService.channelName).toBe("gen-ui");
  });

  it("执行端只读固定输出根：工作区里的旧路径不再有兜底", async () => {
    const { outputRoot, service } = await createFixture();
    const target = {
      workspacePath: join(outputRoot, "..", "..", "workspace"),
      sessionId: "task",
      path: "",
    };
    const sessionDirectory = getGenUiOutputDirectory(outputRoot, {
      workspacePath: target.workspacePath,
      sessionId: target.sessionId,
    });
    await mkdir(sessionDirectory, { recursive: true });
    const sessionPath = join(sessionDirectory, "chart.html");
    await writeFile(sessionPath, '<div id="chart">Hello</div>');
    expect((await service.readDocument({ ...target, path: sessionPath })).html).toContain("Hello");

    // fork 保留父会话路径：读取范围只由输出根决定，session 身份不构成读取限制。
    expect(
      (await service.readDocument({ ...target, sessionId: "forked", path: sessionPath })).html,
    ).toContain("Hello");

    const legacyPath = join(target.workspacePath, "chart.html");
    await mkdir(target.workspacePath, { recursive: true });
    await writeFile(legacyPath, "<div>legacy</div>");
    await expect(service.readDocument({ ...target, path: legacyPath })).rejects.toThrow(
      "host output directory",
    );
  });

  it("widget state 按 workspace 身份与 session 隔离，且对当前 scope 可见", async () => {
    const { service } = await createFixture();
    const target = {
      workspacePath: "/workspace",
      sessionId: "task",
      path: "/workspace/chart.html",
    };
    await service.setState({
      target,
      state: { modelContent: { month: 6 }, privateContent: { tab: "private" } },
    });
    expect(await service.getState(target)).toEqual({
      modelContent: { month: 6 },
      privateContent: { tab: "private" },
    });
    // 同一执行端路径在不同身份/会话下必须是另一份状态（远程 identity 复用路径时尤其重要）。
    expect(await service.getState({ ...target, workspaceIdentity: "remote:other" })).toBeNull();
    expect(await service.getState({ ...target, sessionId: "other" })).toBeNull();
    expect(
      (await service.listState({ workspacePath: "/workspace", sessionId: "task" })).map(
        (entry) => entry.path,
      ),
    ).toEqual(["/workspace/chart.html"]);
    expect(await service.listState({ workspacePath: "/workspace", sessionId: "other" })).toEqual(
      [],
    );
  });

  it("沙箱注册带显式 gen-ui provenance、禁用连接与子框架", async () => {
    const { registrations, service } = await createFixture();
    // 状态里塞入伪造的 script 结束标签：初始快照必须转义后才能进 HTML 外壳。
    // target schema 是 strict 的，这里只传目标字段（prepare 入参还带 html/owner/instanceKey）。
    await service.setState({
      target: {
        workspacePath: exampleGenUiPrepare.workspacePath,
        sessionId: exampleGenUiPrepare.sessionId,
        path: exampleGenUiPrepare.path,
      },
      state: { modelContent: null, privateContent: "</script><script>evil()</script>" },
    });
    await service.prepareSandbox(exampleGenUiPrepare);
    const input = registrations[0];
    expect(input?.contentKind).toBe("gen-ui");
    // gen-ui 不走插件身份，不能携带 pluginId/serverName 或原生权限。
    expect(input?.pluginId).toBeUndefined();
    expect(input?.serverName).toBeUndefined();
    expect(input?.csp?.connectDomains).toEqual([]);
    expect(input?.csp?.frameDomains).toEqual([]);
    expect(input?.csp?.resourceDomains).toEqual(
      GEN_UI_STATIC_DOMAINS.map((host) => `https://${host}`),
    );
    // 初始状态快照必须先于作者脚本注入，且转义 `<` 以关闭 script 逃逸：
    // 整份 HTML 里只应剩下外壳自己的那一个 </script>。
    expect(input!.html.indexOf("zcode-gen-ui-initial-state")).toBeLessThan(
      input!.html.indexOf("__ZCODE_GEN_UI_RUNTIME__"),
    );
    expect(input!.html).toContain("\\u003c/script>");
    // 两处 </script> 都来自外壳自身（状态快照 + 运行时脚本）；状态里的伪造标签被转义后不再新增。
    expect(input!.html.split("</script>")).toHaveLength(3);
  });

  it("缺桌面 Host 沙箱不签发注册，整篇文档也不接受", async () => {
    const { service } = await createFixture({ registerSandbox: false });
    await expect(service.prepareSandbox(exampleGenUiPrepare)).rejects.toThrow(
      "requires a desktop sandbox",
    );
    const { service: wired } = await createFixture();
    await expect(
      wired.prepareSandbox({ ...exampleGenUiPrepare, html: "<!doctype html><html></html>" }),
    ).rejects.toThrow("fragment");
  });
});
