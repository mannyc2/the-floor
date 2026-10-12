// Matches CSS values rather than arbitrary decimal numbers in content or code.
export const hasVisualLiteral = (value: string): boolean =>
  /(?:#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\s*\(|\b\d+(?:\.\d+)?px\b)/i.test(value);

export const hasStyleViolation = (file: string, content: string): boolean => {
  if (file.startsWith("packages/atlas/src/")) return false;
  const uncommented = content.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  if (file.endsWith(".css")) return hasVisualLiteral(uncommented);
  return [...uncommented.matchAll(/\bstyle\s*=\s*(["'])(.*?)\1/gi)].some(match => hasVisualLiteral(match[2] ?? ""))
    || [...uncommented.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)].some(match =>
      hasVisualLiteral(match[1] ?? "")
    );
};
