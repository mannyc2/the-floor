// Imports often omit the source extension, so testing ownership is determined
// before module resolution and also checked again on emitted source-map paths.
export const isTestingPath = (file: string): boolean =>
  file.replaceAll("\\", "/").split("/").some(part =>
    part.endsWith("-testing") || ["test", "testing", "__tests__", "_fixtures", "fixtures", "recordings"].includes(part)
  ) || /\.(test|spec)(?:\.[cm]?[jt]sx?)?$/.test(file);
