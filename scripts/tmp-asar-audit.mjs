// 临时审计脚本：解析 app.asar header，统计内部文件体积排行榜（只读）。
// 内存纪律：只流式读取 header（前 16 字节 + header JSON），绝不整读 asar 内容。
import { openSync, readSync, closeSync } from "node:fs";

const asarPath = process.argv[2];
if (!asarPath) {
  console.error("usage: node tmp-asar-audit.mjs <app.asar>");
  process.exit(1);
}

const fd = openSync(asarPath, "r");
try {
  const head = Buffer.alloc(16);
  readSync(fd, head, 0, 16, 0);
  const headerSize = head.readUInt32LE(12);
  const headerJson = Buffer.alloc(headerSize);
  readSync(fd, headerJson, 0, headerSize, 16);
  const header = JSON.parse(headerJson.toString("utf8"));

  const files = [];
  function walk(node, prefix) {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry.files) {
        walk(entry, path);
      } else if (typeof entry.size === "number") {
        files.push({ path, size: entry.size, unpacked: !!entry.unpacked });
      }
    }
  }
  walk(header, "");

  const total = files.reduce((sum, f) => sum + f.size, 0);
  console.log(`files=${files.length} totalBytes=${total} (${(total / 1048576).toFixed(1)} MB)`);

  console.log("\n=== TOP 40 files ===");
  for (const f of [...files].sort((a, b) => b.size - a.size).slice(0, 40)) {
    console.log(`${(f.size / 1024).toFixed(0).padStart(9)} KB  ${f.path}${f.unpacked ? "  [unpacked]" : ""}`);
  }

  function bucket(path, depth) {
    const parts = path.split("/");
    return parts.slice(0, depth).join("/");
  }

  for (const depth of [1, 2]) {
    const map = new Map();
    for (const f of files) {
      const key = bucket(f.path, depth);
      map.set(key, (map.get(key) ?? 0) + f.size);
    }
    console.log(`\n=== TOP 25 dirs (depth=${depth}) ===`);
    for (const [key, size] of [...map].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      console.log(`${(size / 1048576).toFixed(1).padStart(8)} MB  ${key}`);
    }
  }

  const byExt = new Map();
  for (const f of files) {
    const ext = f.path.includes(".") ? f.path.slice(f.path.lastIndexOf(".")) : "(noext)";
    byExt.set(ext, (byExt.get(ext) ?? 0) + f.size);
  }
  console.log("\n=== TOP 15 extensions ===");
  for (const [key, size] of [...byExt].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`${(size / 1048576).toFixed(1).padStart(8)} MB  ${key}`);
  }
} finally {
  closeSync(fd);
}
