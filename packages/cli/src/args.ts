// argv as positional values and `--flag value` lists. A flag followed by
// another flag (or nothing) is a switch with the value "true"; a repeated
// flag collects every value.

import { parsePoint, UsageError, type ScreenPoint } from "@dolly/core";

export class Args {
  constructor(
    readonly positional: string[] = [],
    readonly flags: Map<string, string[]> = new Map(),
  ) {}

  static parse(argv: readonly string[]): Args {
    const args = new Args();
    for (let i = 0; i < argv.length; i++) {
      const token = argv[i]!;
      if (!token.startsWith("--") || token === "--") {
        args.positional.push(token);
        continue;
      }
      const body = token.slice(2);
      const equals = body.indexOf("=");
      if (equals >= 0) {
        args.add(body.slice(0, equals), body.slice(equals + 1));
        continue;
      }
      const next = argv[i + 1];
      // A negative number is a value, not a flag.
      if (next !== undefined && (!next.startsWith("-") || /^-\d/.test(next))) {
        args.add(body, next);
        i++;
      } else {
        args.add(body, "true");
      }
    }
    return args;
  }

  private add(name: string, value: string) {
    this.flags.set(name, [...(this.flags.get(name) ?? []), value]);
  }

  has(name: string): boolean {
    return this.flags.has(name);
  }

  string(name: string): string | undefined {
    return this.flags.get(name)?.at(-1);
  }

  /** Every value of a repeatable flag, comma lists split. */
  strings(name: string): string[] {
    return (this.flags.get(name) ?? []).flatMap((v) => v.split(",")).filter(Boolean);
  }

  /** Every value as given, without splitting on commas. */
  all(name: string): string[] {
    return this.flags.get(name) ?? [];
  }

  number(name: string, fallback: number): number;
  number(name: string): number | undefined;
  number(name: string, fallback?: number): number | undefined {
    const text = this.string(name);
    if (text === undefined) return fallback;
    const value = Number(text);
    if (text.trim() === "" || Number.isNaN(value)) throw new UsageError(`--${name} wants a number, got ${JSON.stringify(text)}`);
    return value;
  }

  flag(name: string): boolean {
    const value = this.string(name);
    return value !== undefined && !["false", "0", "no"].includes(value);
  }

  point(name: string): ScreenPoint | undefined {
    const text = this.string(name);
    if (text === undefined) return undefined;
    return requirePoint(text);
  }

  positionalNumber(index: number, what: string): number {
    const text = this.positional[index];
    const value = Number(text);
    if (text === undefined || text.trim() === "" || Number.isNaN(value)) throw new UsageError(`expected ${what}`);
    return value;
  }

  positionalString(index: number, what: string): string {
    const text = this.positional[index];
    if (text === undefined) throw new UsageError(`expected ${what}`);
    return text;
  }

  /** `640,400`, or `640 400` as two positionals. */
  positionalPoint(index: number): ScreenPoint {
    const single = parsePoint(this.positional[index] ?? "");
    if (single) return single;
    const x = Number(this.positional[index]);
    const y = Number(this.positional[index + 1]);
    if (this.positional[index + 1] === undefined || Number.isNaN(x) || Number.isNaN(y)) {
      throw new UsageError("expected a point as x,y");
    }
    return { x, y };
  }
}

export function requirePoint(text: string): ScreenPoint {
  const point = parsePoint(text);
  if (!point) throw new UsageError(`expected a point as x,y, got ${JSON.stringify(text)}`);
  return point;
}
