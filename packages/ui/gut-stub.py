"""Polaris stub generator: take upstream file, keep types/consts verbatim, gut function bodies inert.

Usage: python gut-stub.py <upstream-relative-path>...  (paths relative to packages/ui, e.g. src/highspeed/highspeedSend.ts)
Writes gutted file to the same path on disk.
"""
import re
import subprocess
import sys

BANNER = "/** Polaris：业务模块已随红线砍除；此桩保类型与导入形状，函数体恒空、零出网、零业务行为。 */\n"

INERT = "return null as unknown as never;"


def upstream(path: str) -> str:
    return subprocess.run(
        ["git", "show", f"upstream/main:packages/ui/{path}"],
        capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout


def match_brace(text: str, open_idx: int) -> int:
    """Return index of the matching closing brace for the brace at open_idx."""
    depth = 0
    i = open_idx
    n = len(text)
    in_s = None  # ' " `
    while i < n:
        c = text[i]
        if in_s:
            if c == "\\":
                i += 2
                continue
            if c == in_s:
                in_s = None
            i += 1
            continue
        if c in "'\"`":
            in_s = c
        elif c == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            i = (j + 1) if j != -1 else n
            continue
        elif c == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            i = (j + 2) if j != -1 else n
            continue
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError("unbalanced braces")


def next_nonspace(text: str, i: int) -> int:
    n = len(text)
    while i < n and text[i] in " \t\r\n":
        i += 1
    return i


def next_brace_at_paren0(text: str, start: int):
    """Index of next '{' at paren-depth 0 from start, or None."""
    n = len(text)
    i = start
    dp = 0
    in_s = None
    while i < n:
        c = text[i]
        if in_s:
            if c == "\\":
                i += 2
                continue
            if c == in_s:
                in_s = None
            i += 1
            continue
        if c in "'\"`":
            in_s = c
        elif c == "(":
            dp += 1
        elif c == ")":
            dp -= 1
        elif c == "{" and dp == 0:
            return i
        elif c == ";" and dp == 0:
            return None
        i += 1
    return None


def find_body(text: str, seg_from: int, require_arrow: bool = False):
    """Walk from signature end; return (body_open, body_close) or None.

    Handles return-type annotations containing brace object literals:
    after a candidate brace block closes, if the next token is '{' the
    candidate was a return-type literal and the real body follows; if it is
    '=>' an arrow body follows after the arrow; if it is type-continuation
    syntax ('>' '|' '&' ',' ']') the candidate was inside a type annotation
    and scanning resumes at the next brace at paren-depth 0.
    """
    n = len(text)
    i = seg_from
    depth_paren = 0
    in_s = None
    while i < n:
        c = text[i]
        if in_s:
            if c == "\\":
                i += 2
                continue
            if c == in_s:
                in_s = None
            i += 1
            continue
        if c in "'\"`":
            in_s = c
        elif c == "(":
            depth_paren += 1
        elif c == ")":
            depth_paren -= 1
        elif c == ";" and depth_paren == 0:
            return None  # overload declaration or plain const — not guttable here
        elif c == "{" and depth_paren == 0:
            if require_arrow and "=>" not in text[seg_from:i]:
                return None  # plain const initializer — not guttable
            # candidate resolution loop; i always points at a '{'
            while True:
                try:
                    close = match_brace(text, i)
                except ValueError:
                    return None
                nxt = next_nonspace(text, close + 1)
                if nxt >= n:
                    return (i, close)
                ch = text[nxt]
                if ch == "{":
                    # annotation literal then the real body
                    return (nxt, match_brace(text, nxt))
                if text[nxt : nxt + 2] == "=>":
                    # arrow: find its body brace at paren-depth 0
                    j = nxt + 2
                    dp = 0
                    in_s2 = None
                    found = None
                    while j < n:
                        c2 = text[j]
                        if in_s2:
                            if c2 == "\\":
                                j += 2
                                continue
                            if c2 == in_s2:
                                in_s2 = None
                            j += 1
                            continue
                        if c2 in "'\"`":
                            in_s2 = c2
                        elif c2 == "(":
                            dp += 1
                        elif c2 == ")":
                            dp -= 1
                        elif c2 == "{" and dp == 0:
                            found = j
                            break
                        elif c2 == ";" and dp == 0:
                            return None
                        j += 1
                    if found is None:
                        return None
                    return (found, match_brace(text, found))
                if ch in ">|&,]":
                    # candidate was inside/along a type annotation — rescan
                    nb = next_brace_at_paren0(text, close + 1)
                    if nb is None:
                        return None
                    i = nb
                    continue
                return (i, close)
        i += 1
    return None


def gut(text: str) -> str:
    out = []
    pos = 0
    # match export function / export const arrow / export default function
    pat = re.compile(
        r"^export (?:default )?(async )?(function|const) [A-Za-z_$][\w$]*",
        re.M,
    )
    for m in pat.finditer(text):
        start = m.start()
        if start < pos:
            continue
        found = find_body(text, m.end(), require_arrow=(m.group(2) == "const"))
        if found is None:
            continue
        body_open, body_close = found
        head = text[start:body_open]
        if m.group(2) == "const" and "=>" not in head:
            continue
        # indentation of the closing brace line
        line_start = text.rfind("\n", 0, body_close) + 1
        indent = text[line_start:body_close]
        pad = indent if not indent.strip() else ""
        out.append(text[pos:body_open])
        out.append(" {\n  " + INERT + "\n" + pad + "}")
        pos = body_close + 1
    out.append(text[pos:])
    return "".join(out)


def main() -> None:
    for path in sys.argv[1:]:
        src = upstream(path)
        gutted = BANNER + gut(src)
        with open(path.replace("/", "\\"), "w", encoding="utf-8", newline="\n") as f:
            f.write(gutted)
        n_gutted = gutted.count(INERT)
        print(f"gutted({n_gutted}): {path}")


if __name__ == "__main__":
    main()
