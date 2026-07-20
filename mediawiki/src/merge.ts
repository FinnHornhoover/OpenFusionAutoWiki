function sections(text: string) {
  return [
    ...text.matchAll(
      /^== ([^=\n]+) ==\n<!-- OFAW:([^:>]+):v\d+ -->\n[\s\S]*?(?=^== [^=\n]+ ==\n|(?![\s\S]))/gm,
    ),
  ].map((match) => ({ key: match[2], text: match[0].trimEnd() }));
}

const ownedSectionPattern =
  /^== [^=\n]+ ==\n<!-- OFAW:([^:>\n]+):v\d+ -->\n[\s\S]*?(?=^== [^=\n]+ ==\n|(?![\s\S]))/gm;

export function stripOwnedSections(text: string) {
  return text
    .trimEnd()
    .replace(ownedSectionPattern, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function mergeOwnedSections(oldText: string, generated: string) {
  const generatedSections = sections(generated);
  const generatedKeys = new Set(
    generatedSections.map((section) => section.key),
  );
  let result = oldText.trimEnd();
  for (const section of generatedSections) {
    const expression = new RegExp(
      "^== [^=\\n]+ ==\\n<!-- OFAW:" +
        section.key +
        ":v\\d+ -->\\n[\\s\\S]*?(?=^== [^=\\n]+ ==\\n|(?![\\s\\S]))",
      "m",
    );
    result = expression.test(result)
      ? result.replace(expression, section.text + "\n\n")
      : result + (result ? "\n\n" : "") + section.text;
  }
  result = result.replace(ownedSectionPattern, (section, key) =>
    generatedKeys.has(String(key)) ? section : "",
  );
  return result.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function pageTextEqual(left: string, right: string) {
  return left.trimEnd() === right.trimEnd();
}
