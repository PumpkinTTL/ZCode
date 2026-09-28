import { access, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  createDaemonServiceDescriptor,
  createServiceDescriptor,
  serviceDescriptorPath,
  unregisterService,
  type ServicePlatform,
} from "../platform/serviceManager.js";
import { resolveCanonicalServerRoot, type ServerLayout } from "./paths.js";

export async function unregisterInstalledService(layout: ServerLayout): Promise<void> {
  const platform = currentServicePlatform();
  const descriptor = createDaemonServiceDescriptor({ platform, layout });
  const descriptorPath = serviceDescriptorPath(layout, descriptor);
  // 卸载先解除 OS 服务注册，再清理 descriptor/data root；否则 systemd/launchd 可能
  // 在目录删除后继续拉起一个找不到 runtime 的孤儿服务。
  if (await pathExists(descriptorPath)) await unregisterService(descriptor, descriptorPath);
  await unregisterRootScopedAliasServices(layout, platform, descriptorPath);
  await unregisterLegacyServiceForRoot(layout);
}

/**
 * 安装/升级前收口“同一 server-root、不同服务名”的历史注册：
 * 服务标识改名（如 launchd label / task 名）后，旧名字的注册会在登录时继续拉起
 * 第二个 daemon 抢同一个 data root，必须在注册新服务前按 root 扫掉。
 */
export async function unregisterRenamedRootScopedServices(
  layout: ServerLayout,
  currentDescriptorPath: string,
): Promise<void> {
  await unregisterRootScopedAliasServices(layout, currentServicePlatform(), currentDescriptorPath);
}

export async function hasLegacyServiceRegistration(layout: ServerLayout): Promise<boolean> {
  return (await resolveLegacyServiceRegistration(layout)) !== null;
}

export async function unregisterLegacyServiceForRoot(layout: ServerLayout): Promise<boolean> {
  const legacy = await resolveLegacyServiceRegistration(layout);
  if (!legacy) return false;
  await unregisterService(legacy.descriptor, legacy.descriptorPath);
  await rm(legacy.descriptorPath, { force: true });
  return true;
}

async function resolveLegacyServiceRegistration(layout: ServerLayout): Promise<{
  descriptor: ReturnType<typeof createServiceDescriptor>;
  descriptorPath: string;
} | null> {
  const platform = currentServicePlatform();
  const kind =
    platform === "darwin" ? "launchd" : platform === "linux" ? "systemd" : "task-scheduler";
  const descriptorPath = join(layout.serviceDir, `${kind}.service`);
  if (!(await legacyDescriptorBelongsToRoot(descriptorPath, platform, layout.serverRoot)))
    return null;
  // 旧描述符里的名字必须按**磁盘上的内容**取，不能沿用当前默认名：Windows 的
  // schtasks 删除是按 task name，用新名去删旧任务会既删不掉又留下孤儿任务。
  const legacyEntryName = `${kind}.service`;
  const content = await readFile(descriptorPath, "utf8").catch(() => null);
  const onDiskName = content ? descriptorNameFromContent(content, platform, legacyEntryName) : null;
  return {
    descriptor: createServiceDescriptor({
      platform,
      // 旧 launcher 名（zcode）保留：这些注册本来就指向旧路径，卸载只需要正确的名字与路径。
      command: join(layout.stableBinDir, platform === "win32" ? "zcode.cmd" : "zcode"),
      args: ["serve", "--supervisor", "--server-root", layout.serverRoot],
      ...(onDiskName ? { name: onDiskName } : {}),
    }),
    descriptorPath,
  };
}

function currentServicePlatform(): ServicePlatform {
  return process.platform === "darwin" || process.platform === "linux" ? process.platform : "win32";
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function legacyDescriptorBelongsToRoot(
  descriptorPath: string,
  platform: ServicePlatform,
  serverRoot: string,
): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(descriptorPath, "utf8");
  } catch {
    return false;
  }
  if (serviceDescriptorBelongsToRoot(content, platform, serverRoot)) return true;
  const declaredRoot = extractServerRoot(content, platform);
  if (!declaredRoot) return false;
  try {
    return (await resolveCanonicalServerRoot(declaredRoot)) === serverRoot;
  } catch {
    return false;
  }
}

async function unregisterRootScopedAliasServices(
  layout: ServerLayout,
  platform: ServicePlatform,
  currentDescriptorPath: string,
): Promise<void> {
  // 过去只按当前拼写的 stablePathId 卸载 descriptor，root 别名留下的旧注册会
  // 在卸载后继续被 launchd/systemd 拉起。扫描同一 service 目录并按 canonical root 比对。
  const extension = platform === "darwin" ? ".plist" : platform === "linux" ? ".service" : ".json";
  const legacyEntry =
    platform === "darwin"
      ? "launchd.service"
      : platform === "linux"
        ? "systemd.service"
        : "task-scheduler.service";
  let entries: string[];
  try {
    entries = await readdir(layout.serviceDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const descriptorPath = join(layout.serviceDir, entry);
    if (
      descriptorPath === currentDescriptorPath ||
      entry === legacyEntry ||
      !entry.endsWith(extension)
    )
      continue;
    const content = await readFile(descriptorPath, "utf8").catch(() => null);
    if (!content) continue;
    const declaredRoot = extractServerRoot(content, platform);
    if (!declaredRoot) continue;
    let belongs = false;
    try {
      belongs = (await resolveCanonicalServerRoot(declaredRoot)) === layout.serverRoot;
    } catch {
      continue;
    }
    if (!belongs) continue;
    const name = descriptorNameFromContent(content, platform, entry);
    if (!name) continue;
    await unregisterService(
      {
        kind:
          platform === "darwin" ? "launchd" : platform === "linux" ? "systemd" : "task-scheduler",
        name,
        content,
      },
      descriptorPath,
    );
    await rm(descriptorPath, { force: true });
  }
}

function extractServerRoot(content: string, platform: ServicePlatform): string | null {
  if (platform === "win32") {
    try {
      const parsed = JSON.parse(content) as { args?: unknown };
      if (!Array.isArray(parsed.args)) return null;
      const index = parsed.args.indexOf("--server-root");
      return typeof parsed.args[index + 1] === "string" ? parsed.args[index + 1] : null;
    } catch {
      return null;
    }
  }
  const match =
    platform === "darwin"
      ? content.match(/<string>--server-root<\/string><string>([^<]+)<\/string>/u)
      : content.match(/'--server-root'\s+'((?:[^']|'\\'\\'\\'')*)'/u);
  return match?.[1]?.replaceAll("'\\''", "'") ?? null;
}

function descriptorNameFromContent(
  content: string,
  platform: ServicePlatform,
  entry: string,
): string | null {
  if (platform === "darwin")
    return content.match(/<key>Label<\/key><string>([^<]+)<\/string>/u)?.[1] ?? null;
  if (platform === "win32") {
    try {
      const parsed = JSON.parse(content) as { taskName?: unknown };
      return typeof parsed.taskName === "string" ? parsed.taskName : null;
    } catch {
      return null;
    }
  }
  return entry.endsWith(".service") ? entry.slice(0, -".service".length) : null;
}

function serviceDescriptorBelongsToRoot(
  content: string,
  platform: ServicePlatform,
  serverRoot: string,
): boolean {
  if (platform === "win32") {
    try {
      const parsed = JSON.parse(content) as { args?: unknown };
      if (!Array.isArray(parsed.args)) return false;
      const index = parsed.args.indexOf("--server-root");
      return index >= 0 && parsed.args[index + 1] === serverRoot;
    } catch {
      return false;
    }
  }
  const encodedRoot =
    platform === "darwin"
      ? serverRoot
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
      : `'${serverRoot.replaceAll("'", "'\\''")}'`;
  return platform === "darwin"
    ? content.includes(`<string>--server-root</string><string>${encodedRoot}</string>`)
    : content.includes(`'--server-root' ${encodedRoot}`);
}
