import { DateTime, Option } from "effect";

// oxlint-disable-next-line effect/noNullish -- HTTP reading DTOs use null for unavailable data; formatting is their final display boundary.
type Reading = number | null | undefined;
const finite = (value: Reading) => Option.fromNullishOr(value).pipe(Option.filter(Number.isFinite));
export const number = (value: Reading, digits = 2): string =>
  Option.match(finite(value), {
    onNone: () => "—",
    onSome: amount => new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(amount),
  });
export const compact = (value: Reading): string =>
  Option.match(finite(value), {
    onNone: () => "—",
    onSome: amount => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(amount),
  });
export const money = (value: Reading): string =>
  Option.match(finite(value), {
    onNone: () => "—",
    onSome: amount => `$${number(amount, amount < 0.01 ? 8 : amount < 1 ? 4 : 2)}`,
  });
export const shortAddress = (value: string): string =>
  value.length > 18 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
export const time = (value: string): string =>
  Option.match(DateTime.make(value), {
    onNone: () => "—",
    onSome: instant => DateTime.format(instant, { locale: "en-US", hour: "2-digit", minute: "2-digit" }),
  });
export const date = (value: string): string =>
  Option.match(DateTime.make(value), {
    onNone: () => "—",
    onSome: instant => DateTime.format(instant, { locale: "en-GB", day: "numeric", month: "long", year: "numeric" }),
  });
export const safeUrl = (value: string): string =>
  value.startsWith("https://") || value.startsWith("http://") ? value : "#";
export const chainName = (chainId: number): string =>
  chainId === 8453 ? "Base" : chainId === 84532 ? "Base Sepolia" : `Chain ${chainId}`;
export const transactionUrl = (chainId: number, hash: string): Option.Option<string> => {
  if (chainId === 8453) return Option.some(`https://basescan.org/tx/${hash}`);
  if (chainId === 84532) return Option.some(`https://sepolia.basescan.org/tx/${hash}`);
  return Option.none();
};
