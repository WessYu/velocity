export function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

export function findMatches(source, pattern, createIssue) {
  return [...source.matchAll(pattern)].map((match) => ({
    ...createIssue(match),
    line: lineAt(source, match.index)
  }));
}

export function maskNonCode(source) {
  let output = "";
  let state = "code";
  let quote = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "code") {
      if (character === "/" && next === "/") {
        output += "  ";
        index += 1;
        state = "line-comment";
      } else if (character === "/" && next === "*") {
        output += "  ";
        index += 1;
        state = "block-comment";
      } else if (character === '"' || character === "'" || character === "`") {
        output += " ";
        quote = character;
        state = "string";
      } else if (character === "/" && /[=(:,[!&|?;{}>]/.test(output.trimEnd().at(-1) ?? "=")) {
        output += " ";
        state = "regex";
      } else {
        output += character;
      }
      continue;
    }

    if (state === "line-comment") {
      output += character === "\n" ? "\n" : " ";
      if (character === "\n") state = "code";
      continue;
    }

    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        output += "  ";
        index += 1;
        state = "code";
      } else {
        output += character === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (state === "regex") {
      if (character === "\\") {
        output += " ";
        if (index + 1 < source.length) {
          output += source[index + 1] === "\n" ? "\n" : " ";
          index += 1;
        }
      } else if (character === "/") {
        output += " ";
        state = "code";
      } else {
        output += character === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (character === "\\") {
      output += " ";
      if (index + 1 < source.length) {
        output += source[index + 1] === "\n" ? "\n" : " ";
        index += 1;
      }
    } else if (character === quote) {
      output += " ";
      state = "code";
    } else {
      output += character === "\n" ? "\n" : " ";
    }
  }

  return output;
}
