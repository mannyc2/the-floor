// Imports often omit the source extension, so testing ownership is determined
// before module resolution and also checked again on emitted source-map paths.
export const isTestingPath = (file: string): boolean =>
  file.replaceAll("\\", "/").split("/").some(part =>
    part.endsWith("-testing") || ["test", "testing", "__tests__", "_fixtures", "fixtures", "recordings"].includes(part)
  ) || /\.(test|spec)(?:\.[cm]?[jt]sx?)?$/.test(file);

// Bare imports, resolved paths and Bun's versioned cache paths must name the
// same forbidden capability; checking only the SDK root misses its dependencies.
export const isWalletOraclePath = (file: string): boolean =>
  /(?:^|\/)(?:@privy-io\/node|svix|@hpke\/[^/@]+)(?:@[^/]+)?(?:\/|$)/.test(file.replaceAll("\\", "/"));

export const isPrivySolanaKitPath = (file: string): boolean =>
  /(?:^|\/)@privy-io\/node(?:@[^/]+)?\/(?:.*\/)?solana-kit(?:[./]|$)/.test(file.replaceAll("\\", "/"));
