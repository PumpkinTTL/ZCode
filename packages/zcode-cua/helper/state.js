// 观察状态：索引空间 / 树渲染 / 摘要。对齐官方语义：
// - 全量观察重排索引（按树序 0..n-1）；
// - 增量观察里未变元素保留旧索引（"unchanged rows are omitted and their indices stay valid"），
//   新元素取 nextIndex 之后的号；
// - effect evidence：动作后一次观察若元素摘要未变，附上 "unchanged" 告知块。
import { createHash, randomBytes } from "node:crypto";

export function shortId(prefix) {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

export function randomToken(bytes = 16) {
  return randomBytes(bytes).toString("hex");
}

export function clip(text, max) {
  if (typeof text !== "string") return "";
  const oneLine = text.replaceAll(/\s+/gu, " ");
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/** UIA role → ZCode kind。未知 role 小写直传（模型按字符串读，不会失真到误导）。 */
export const ROLE_TO_KIND = Object.freeze({
  Button: "button",
  SplitButton: "button",
  CheckBox: "checkbox",
  RadioButton: "radio",
  ComboBox: "combobox",
  Edit: "textfield",
  Document: "document",
  Text: "text",
  Hyperlink: "link",
  Image: "image",
  List: "list",
  ListItem: "listitem",
  Menu: "menu",
  MenuBar: "menubar",
  MenuItem: "menuitem",
  Tree: "tree",
  TreeItem: "treeitem",
  Tab: "tablist",
  TabItem: "tab",
  ToolBar: "toolbar",
  StatusBar: "statusbar",
  TitleBar: "titlebar",
  ProgressBar: "progressbar",
  Slider: "slider",
  ScrollBar: "scrollbar",
  Separator: "separator",
  Table: "table",
  DataGrid: "table",
  DataItem: "row",
  Header: "header",
  HeaderItem: "headeritem",
  Window: "window",
  Pane: "group",
  Group: "group",
  Custom: "group",
  Thumb: "thumb",
  ToolTip: "tooltip",
});

export function roleToKind(role) {
  if (typeof role !== "string" || role === "") return "element";
  return ROLE_TO_KIND[role] ?? role.toLowerCase();
}

function identityKey(row) {
  return `${row.role ?? ""}|${row.label ?? ""}|${row.value ?? ""}`;
}

/**
 * 把 driver 的 elements 映射成 ZCode 元素并分配索引。
 * full=true 时按树序重排；否则未变元素保留旧索引。
 */
export function assignIndices(previous, driverElements, full) {
  const byIndex = new Map();
  const indexByKey = new Map();
  let nextIndex = 0;
  const elements = [];
  for (const [position, row] of driverElements.entries()) {
    const key = identityKey(row);
    let index;
    if (full || !previous) {
      index = position;
    } else if (previous.indexByKey.has(key)) {
      index = previous.indexByKey.get(key);
    } else {
      index = previous.nextIndex;
      while (byIndex.has(index)) index += 1;
    }
    indexByKey.set(key, index);
    nextIndex = Math.max(nextIndex, index + 1);
    const mapped = {
      index,
      kind: roleToKind(row.role),
      title: row.label ?? null,
      value: row.value ?? null,
      actions: Array.isArray(row.actions) ? [...row.actions] : [],
      token: typeof row.element_token === "string" ? row.element_token : undefined,
      frame: row.frame ?? undefined,
      screenshot_frame: row.screenshot_frame ?? undefined,
      enabled: row.enabled !== false,
      selected: row.selected === true,
      parent_index: Number.isInteger(row.parent_index) ? row.parent_index : undefined,
      depth: Number.isInteger(row.depth) ? row.depth : undefined,
    };
    elements.push(mapped);
    byIndex.set(index, mapped);
  }
  return { elements, byIndex, indexByKey, nextIndex };
}

export function digestElements(elements) {
  const compact = elements.map((el) => [
    el.kind,
    el.title,
    el.value,
    el.enabled,
    el.selected,
    el.actions,
  ]);
  return createHash("sha1").update(JSON.stringify(compact)).digest("hex");
}

function renderRow(el) {
  const indent = "  ".repeat(Math.min(el.depth ?? 0, 12));
  let row = `${indent}[${el.index}] ${el.kind}`;
  if (el.title != null && el.title !== "") row += ` "${clip(el.title, 120)}"`;
  if (el.value != null && el.value !== "") row += ` = "${clip(el.value, 160)}"`;
  if (el.enabled === false) row += " [disabled]";
  if (el.actions.length > 0) row += ` (actions: ${el.actions.join(", ")})`;
  return row;
}

function header(snapshot) {
  const title = snapshot.windowTitle ?? snapshot.appName;
  return `window "${clip(title, 120)}" (app: ${clip(snapshot.appName, 80)}, window: ${snapshot.windowId})`;
}

export function renderTreeText(snapshot) {
  const rows = [header(snapshot)];
  for (const el of snapshot.elements) rows.push(renderRow(el));
  rows.push(`# ${snapshot.elements.length} elements`);
  return rows.join("\n");
}

/**
 * 增量渲染：未变的行省略、索引保持；removed/added/changed 分组。
 * 匹配用 identity key（role|label|value 的多重集），changed 用弱 key（role|label）。
 */
export function renderTreeDiff(previous, current) {
  const prevRows = new Map();
  for (const el of previous.elements) {
    const key = `${el.kind}|${el.title ?? ""}|${el.value ?? ""}`;
    prevRows.set(key, (prevRows.get(key) ?? 0) + 1);
  }
  const removed = [];
  const added = [];
  const unchangedMultiset = new Map(prevRows);
  for (const el of current.elements) {
    const key = `${el.kind}|${el.title ?? ""}|${el.value ?? ""}`;
    const count = unchangedMultiset.get(key) ?? 0;
    if (count > 0) unchangedMultiset.set(key, count - 1);
    else added.push(el);
  }
  for (const el of previous.elements) {
    const key = `${el.kind}|${el.title ?? ""}|${el.value ?? ""}`;
    const count = unchangedMultiset.get(key) ?? 0;
    if (count > 0) {
      unchangedMultiset.set(key, count - 1);
      removed.push(el);
    }
  }
  const changed = [];
  if (removed.length > 0 && added.length > 0) {
    const weakPrev = new Map();
    for (const el of removed) {
      const wk = `${el.kind}|${el.title ?? ""}`;
      weakPrev.set(wk, el);
    }
    const stillAdded = [];
    for (const el of added) {
      const wk = `${el.kind}|${el.title ?? ""}`;
      const hit = weakPrev.get(wk);
      if (hit) {
        changed.push(el);
        weakPrev.delete(wk);
        const at = removed.indexOf(hit);
        if (at >= 0) removed.splice(at, 1);
      } else {
        stillAdded.push(el);
      }
    }
    added.length = 0;
    added.push(...stillAdded);
  }
  const rows = [header(current)];
  if (removed.length > 0) {
    rows.push("removed:");
    for (const el of removed) rows.push(`  ${renderRow(el)}`);
  }
  if (added.length > 0) {
    rows.push("added:");
    for (const el of added) rows.push(`  ${renderRow(el)}`);
  }
  if (changed.length > 0) {
    rows.push("changed:");
    for (const el of changed) rows.push(`  ${renderRow(el)}`);
  }
  if (removed.length + added.length + changed.length === 0) {
    rows.push("(no change)");
  }
  rows.push(`# ${current.elements.length} elements (diff)`);
  return rows.join("\n");
}
