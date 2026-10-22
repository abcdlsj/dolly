#!/usr/bin/env bun
// The `dolly` command. Ships as one binary (`bun build --compile`) next to the
// platform driver.

import { systemContext } from "./context.ts";
import { encode, run } from "./run.ts";

const output = await run(process.argv.slice(2), systemContext());
process.stdout.write(encode(output) + "\n");
process.exit(output.code);
