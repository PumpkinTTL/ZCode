import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("runner debug storage rollback", () => {
  it("不再引用已删除的 storage profile 模块", async () => {
    const source = await readFile(
      new URL("../src/model/runner-debug.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("zcode-storage-root");
    // 品牌改名后 storage root 由常量承载（不内联字面量），断言常量与拼接形态。
    expect(source).toContain('DATA_ROOT_DIR_NAME = ".polaris"');
    expect(source).toContain('join(homedir(), DATA_ROOT_DIR_NAME, "cli"');
  });
});
