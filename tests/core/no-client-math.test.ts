import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A tripwire for the rule the SDK is built on: no money arithmetic on the
 * client. Every figure comes from POST /quote. If this fails, the new code
 * is working out a price; take the figure from the quote instead.
 */
const SRC = join(__dirname, "../../src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "generated") return [];
    return statSync(p).isDirectory()
      ? files(p)
      : /\.tsx?$/.test(name)
        ? [p]
        : [];
  });

const FORBIDDEN = [
  /Cents\s*\*/, // unitAmountCents * quantity
  /\*\s*\w*(quantity|Cents)\b/i,
  /Cents\s*[+-]\s*\w*Cents/, // subtotalCents + shippingCents
  /\.reduce\([^)]*Cents/, // summing amounts
  /percentBps\s*\*|\*\s*percentBps/,
];

describe("no client-side money math", () => {
  it.each(files(SRC).map((f) => [f.slice(SRC.length + 1), f]))(
    "%s",
    (_name, file) => {
      const code = readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
      for (const pattern of FORBIDDEN)
        expect(
          code.filter((l) => pattern.test(l)),
          String(pattern)
        ).toEqual([]);
    }
  );
});
