import { getAddressDecoder } from "@solana/kit";
import {
  getCreateConfigInstruction,
  getInitializeVirtualPoolWithSplTokenInstruction,
  programAddress,
} from "./bounded-instructions.ts";
import { config } from "./config.ts";

const bytes = {};
for (const file of [
  "idl.json", "instruction-oracle.json", "result.json", "construction.ts",
  "bounded-instructions.ts", "bounded-client.py", "config.ts", "config-oracle.mjs", "rpc-counts.json",
]) {
  bytes[file] = await Bun.file(new URL(file, import.meta.url)).arrayBuffer();
}
const read = (file) => JSON.parse(new TextDecoder().decode(bytes[file]));
const idl = read("idl.json");
const oracle = read("instruction-oracle.json");
const result = read("result.json");
const checks = [];
const compare = (name, actual, expected) => checks.push({
  name,
  pass: JSON.stringify(actual) === JSON.stringify(expected),
  actual,
  expected,
});
const camel = (name) => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
const decoder = getAddressDecoder();

for (const [name, builder, params] of [
  ["create_config", getCreateConfigInstruction, config],
  ["initialize_virtual_pool_with_spl_token", getInitializeVirtualPoolWithSplTokenInstruction,
    { name: "Spike", symbol: "SPK", uri: "https://example.invalid/spike" }],
]) {
  const description = idl.instructions.find((item) => item.name === name);
  const inputs = Object.fromEntries(description.accounts
    .filter((account) => account.address === undefined && account.name !== "program")
    .map((account, index) => [camel(account.name), decoder.decode(new Uint8Array(32).fill(index + 17))]));
  const instruction = builder(inputs, params);
  compare(`${name} program`, instruction.programAddress, idl.address);
  compare(`${name} account count`, instruction.accounts.length, description.accounts.length);
  compare(`${name} discriminator`, [...instruction.data.slice(0, 8)], description.discriminator);
  description.accounts.forEach((account, index) => {
    const expectedAddress = account.address
      ?? (account.name === "program" ? programAddress : inputs[camel(account.name)]);
    const expectedRole = (account.writable ? 1 : 0) + (account.signer ? 2 : 0);
    compare(`${name} account ${index} ${account.name}`, instruction.accounts[index], {
      address: expectedAddress,
      role: expectedRole,
    });
  });
}

for (const run of ["first", "second"]) {
  compare(`${run} SDK instruction bytes/accounts`, result[run].instructions, oracle.instructions);
  compare(`${run} SDK transaction byte length`, result[run].byteLength, oracle.byteLength);
  compare(`${run} SDK transaction SHA-256`, result[run].sha256, oracle.sha256);
  compare(`${run} unsigned`, result[run].attachedSignatures, 0);
  compare(`${run} required signer count`, result[run].requiredSigners.length, 3);

}
const counters = read("rpc-counts.json");
compare("fixture requests before construction", counters.before, 0);
compare("actual fixture request delta for two constructions", counters.after - counters.before, 2);
compare("deterministic repeated construction", result.first, result.second);
compare("Bun absent in recorded Worker", result.bunPresent, false);
const report = {
  status: checks.every((item) => item.pass) ? "technical_pass" : "fail",
  checkCount: checks.length,
  failures: checks.filter((item) => !item.pass),
  sdkTransaction: { byteLength: oracle.byteLength, sha256: oracle.sha256 },
  sourceReview: {
    accountOrderRolesConstants: "IDL parity verified independently with unique sentinel addresses per input.",
    codecs: "Codama-generated binary parameter codecs; IDL-derived instruction wrappers; no hand-authored encoding offsets.",
    pdaDerivation: "Kit derivation uses the event-authority, pool, vault and metadata seeds; fixed quote/base byte ordering is documented and matches SDK oracle addresses.",
    unsignedBoundary: "Construction returns serialized unsigned bytes with three required signers and zero attached signatures.",
    networkBoundary: "Construction uses Effect HTTP; the actual server counter increased from 0 to 2 across two constructions. The oracle review itself performs no networking.",
  },
  limitations: [
    "This is the fixed legacy SPL-token fixture, not arbitrary token ordering, Token-2022, full quote logic or every program instruction.",
    "The quote-owner response schema deliberately pins fixture slot zero and the SPL Token owner; it is not a live-provider response schema.",
    "Worker result provenance and complete bundle/import fences are verified by the parent integration task, not inferred from this review.",
    "No transaction was signed, submitted, simulated or executed on chain.",
  ],
  sources: Object.fromEntries(Object.entries(bytes).map(([name, data]) => [name, {
    bytes: data.byteLength,
    sha256: new Bun.CryptoHasher("sha256").update(data).digest("hex"),
  }])),
  checks,
};
await Bun.write(new URL("./construction-review.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: report.status, checkCount: checks.length, failures: report.failures.length }));
if (report.failures.length > 0) throw new Error("Independent construction review failed");
