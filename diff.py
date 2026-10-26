#!/usr/bin/env python3
"""Write a word-level CriticMarkup diff, preserving new highlights/comments.

Usage: python3 diff.py ORIGINAL.md NEW.md
Writes diff.md beside NEW.md, preserving the new file's highlights/comments.
"""

import argparse
import difflib
import re
from pathlib import Path

TOKENS = re.compile(r"\s+|\w+|[^\w\s]")
ANNOTATIONS = re.compile(r"\{>>[\s\S]*?<<\}|\{==|==\}")


def comparison_view(text):
    """Separate annotations from text, recording their character positions."""
    parts, markers = [], []
    start = length = 0
    for match in ANNOTATIONS.finditer(text):
        part = text[start:match.start()]
        parts.append(part)
        length += len(part)
        markers.append((length, match.group()))
        start = match.end()
    parts.append(text[start:])
    return "".join(parts), markers


def create_diff(old, new):
    old, _ = comparison_view(old)
    new, markers = comparison_view(new)
    old_tokens, new_tokens = TOKENS.findall(old), TOKENS.findall(new)
    offsets = [0]
    for token in new_tokens:
        offsets.append(offsets[-1] + len(token))
    output = []
    marker_index = 0

    def emit(text, kind="equal"):
        if text:
            if kind == "equal":
                output.append(text)
            else:
                opening, closing = ("{++", "++}") if kind == "insert" else ("{--", "--}")
                output.extend((opening, text, closing))

    def emit_new(start, end, kind):
        nonlocal marker_index
        start, end = offsets[start], offsets[end]
        while marker_index < len(markers) and markers[marker_index][0] <= end:
            position, marker = markers[marker_index]
            emit(new[start:position], kind)
            output.append(marker)
            start = position
            marker_index += 1
        emit(new[start:end], kind)

    matcher = difflib.SequenceMatcher(None, old_tokens, new_tokens, autojunk=False)
    opcodes = matcher.get_opcodes()
    merged = []
    index = 0
    while index < len(opcodes):
        operation, a, b, c, d = opcodes[index]
        if operation != "equal":
            # Include shared spaces between consecutive changes in both spans.
            while index + 2 < len(opcodes):
                gap, ga, gb, _, _ = opcodes[index + 1]
                following, _, nb, _, nd = opcodes[index + 2]
                if (gap != "equal" or following == "equal"
                        or not re.fullmatch(r"[^\S\r\n]+", "".join(old_tokens[ga:gb]))):
                    break
                b, d = nb, nd
                index += 2
            operation = "replace" if a < b and c < d else operation
        merged.append((operation, a, b, c, d))
        index += 1

    for operation, a, b, c, d in merged:
        if operation in {"delete", "replace"}:
            emit("".join(old_tokens[a:b]), "delete")
        emit_new(c, d, "insert" if operation == "replace" else operation)
    emit_new(len(new_tokens), len(new_tokens), "equal")
    return "".join(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("old", type=Path)
    parser.add_argument("new", type=Path)
    args = parser.parse_args()
    result = create_diff(args.old.read_text(encoding="utf-8"), args.new.read_text(encoding="utf-8"))
    args.new.with_name("diff.md").write_text(result, encoding="utf-8")


if __name__ == "__main__":
    main()
