/**
 * electron manifest 请求 URL 契约回归（vitest，零网络）。
 *
 * cbcn-cloud /api/v1/releases/electron/manifest 的客户端身份参数（2026-10-12 起
 * 服务端契约的客户端半边）：
 *   - client_id：接入方 AppID（服务端缺省 'polaris' 是单客户端时期的历史默认，
 *     必须显式上报，否则默认值一变就静默读到别的应用发布目录）；
 *   - version：当前版本——「更新检查即在线心跳」按版本分桶，不传则该客户端
 *     从不入在线统计（Electron 通道在线数恒为零的根因）；
 *   - device_mid：在线去重的身份键，与 host 侧心跳 device 同值（同设备不双计）。
 */
import { describe, expect, it } from "vitest";
import { buildElectronManifestUrl } from "./manifestUpdateProvider.js";

describe("buildElectronManifestUrl", () => {
  it("带上平台/通道与三个身份参数（client_id / version / device_mid）", () => {
    const url = buildElectronManifestUrl({
      endpointOrigin: "https://nimbus.example.com",
      platform: "windows-x86_64",
      clientId: "polaris",
      currentVersion: "1.0.1",
      deviceMid: "0f8c4f4e-1111-2222-3333-444455556666",
      channel: "stable",
    });
    expect(url.origin).toBe("https://nimbus.example.com");
    expect(url.pathname).toBe("/api/v1/releases/electron/manifest");
    expect(url.searchParams.get("platform")).toBe("windows-x86_64");
    expect(url.searchParams.get("client_id")).toBe("polaris");
    expect(url.searchParams.get("version")).toBe("1.0.1");
    expect(url.searchParams.get("device_mid")).toBe("0f8c4f4e-1111-2222-3333-444455556666");
    // 通道发数字码：stable=1 / preview=3（服务端 mapReleaseChannelToApiValue 同款映射）
    expect(url.searchParams.get("channel")).toBe("1");
  });

  it("preview 通道发数字码 3；可选项缺省时不出键（服务端各参数均可缺省）", () => {
    const url = buildElectronManifestUrl({
      endpointOrigin: "https://nimbus.example.com",
      platform: "darwin-arm64",
      channel: "preview",
    });
    expect(url.searchParams.get("channel")).toBe("3");
    expect(url.searchParams.has("client_id")).toBe(false);
    expect(url.searchParams.has("version")).toBe(false);
    expect(url.searchParams.has("device_mid")).toBe(false);
  });

  it("空白值视同缺省（不产生空参数键）", () => {
    const url = buildElectronManifestUrl({
      endpointOrigin: "https://nimbus.example.com",
      platform: "windows-x86_64",
      clientId: "  ",
      currentVersion: " ",
      deviceMid: "",
      channel: "stable",
    });
    expect(url.searchParams.has("client_id")).toBe(false);
    expect(url.searchParams.has("version")).toBe(false);
    expect(url.searchParams.has("device_mid")).toBe(false);
  });

  it("manifestUrl 覆盖时参数仍绑定在覆盖地址上（dev 联调 / 自定义 feed）", () => {
    const url = buildElectronManifestUrl({
      endpointOrigin: "https://ignored.example.com",
      manifestUrl: "http://127.0.0.1:8000/api/v1/releases/electron/manifest",
      platform: "windows-x86_64",
      clientId: "polaris",
      currentVersion: "1.0.2",
      channel: "stable",
    });
    expect(url.origin).toBe("http://127.0.0.1:8000");
    expect(url.searchParams.get("client_id")).toBe("polaris");
    expect(url.searchParams.get("version")).toBe("1.0.2");
  });
});
