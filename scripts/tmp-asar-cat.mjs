// 临时脚本：从 app.asar 读取单个文件（cat 模式）或列出目录。
// 内存纪律：流式读 header + 定点 readSync，绝不整读 asar。cat 支持 head:<N> 只取前 N 字节。
import { openSync, readSync, closeSync } from "node:fs";

const [asarPath, mode, target, arg] = process.argv.slice(2);
const fd = openSync(asarPath, "r");

let headerSize;
{
  const head = Buffer.alloc(16);
  readSync(fd, head, 0, 16, 0);
  headerSize = head.readUInt32LE(12);
}
const headerJson = Buffer.alloc(headerSize);
readSync(fd, headerJson, 0, headerSize, 16);
const header = JSON.parse(headerJson.toString("utf8"));
const dataStart = 16 + headerSize;

function findNode(p) {
  const parts = p.split("/").filter(Boolean);
  let node = header;
  for (const part of parts) {
    if (!node.files || !node.files[part]) return null;
    node = node.files[part];
  }
  return node;
}

try {
  if (mode === "cat") {
    const node = findNode(target);
    if (!node || node.files) {
      console.error("not a file: " + target);
      process.exit(1);
    }
    const limit = arg && arg.startsWith("head:") ? Number(arg.slice(5)) : node.size;
    const offset = dataStart + Number(node.offset ?? 0);
    const buf = Buffer.alloc(Math.min(limit, node.size));
    readSync(fd, buf, 0, buf.length, offset);
    process.stdout.write(buf);
  } else if (mode === "list") {
    const node = findNode(target) ?? header;
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      console.log(`${entry.files ? "d" : "f"} ${String(entry.size ?? "").padStart(10)}  ${name}`);
    }
  } else {
    console.error("usage: tmp-asar-cat.mjs <asar> cat|list <path> [head:N]");
    process.exit(1);
  }
} finally {
  closeSync(fd);
}
