// Talking to the platform driver: over the service's socket when one answers,
// else by running the driver binary for one request.

import { spawn } from "node:child_process";
import { connect } from "node:net";
import { Code, type Op, type Params, type Request, type Response, type Result } from "@dolly/protocol";
import { Failure } from "./failure.ts";
import { driverBinary, socketPath } from "./paths.ts";

export interface Driver {
  call<O extends Op>(op: O, params: Params<O>): Promise<Result<O>>;
}

function unwrap<O extends Op>(response: Response<O>): Result<O> {
  if (!response.ok) throw new Failure(response.error, response.code);
  const { ok: _, ...result } = response;
  return result as unknown as Result<O>;
}

function parse(line: string, from: string): Response {
  try {
    return JSON.parse(line) as Response;
  } catch {
    throw new Failure(`${from} answered with something that is not JSON: ${line.slice(0, 200)}`);
  }
}

class NoService extends Error {}

/** One request per connection, one line each way. */
export class SocketDriver implements Driver {
  constructor(readonly path: string = socketPath()) {}

  call<O extends Op>(op: O, params: Params<O>): Promise<Result<O>> {
    return this.send({ op, ...params } as unknown as Request).then((line) => unwrap(parse(line, "the driver service") as Response<O>));
  }

  private send(request: Request): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.path);
      let buffer = "";
      let connected = false;
      socket.setEncoding("utf8");
      socket.on("connect", () => {
        connected = true;
        socket.write(JSON.stringify(request) + "\n");
      });
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline >= 0) {
          socket.end();
          resolve(buffer.slice(0, newline));
        }
      });
      socket.on("error", (error: NodeJS.ErrnoException) => {
        reject(connected ? new Failure(`driver service: ${error.message}`) : new NoService(error.message));
      });
      socket.on("close", () => {
        if (connected && !buffer.includes("\n")) reject(new Failure("the driver service closed the connection"));
      });
    });
  }
}

/** Runs `dolly-driver call` once per request, the request on stdin. */
export class ProcessDriver implements Driver {
  constructor(readonly binary: string = driverBinary()) {}

  call<O extends Op>(op: O, params: Params<O>): Promise<Result<O>> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, ["call"], { stdio: ["pipe", "pipe", "inherit"] });
      let out = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (out += chunk));
      child.on("error", () =>
        reject(new Failure(`no driver at ${this.binary}; install Dolly.app or set DOLLY_DRIVER`, Code.failed)),
      );
      child.on("close", () => {
        const line = out.split("\n").find((l) => l.trim());
        if (!line) return reject(new Failure(`${this.binary} printed nothing`));
        try {
          resolve(unwrap(parse(line, this.binary) as Response<O>));
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(JSON.stringify({ op, ...params }) + "\n");
    });
  }
}

/**
 * The service when it answers, else a direct run. The service matters on
 * macOS: Accessibility belongs to a process, and a driver started by an
 * untrusted shell inherits the shell's identity, so its events are dropped.
 * `DOLLY_LOCAL=1` forces the direct run.
 */
export class AutoDriver implements Driver {
  private readonly socket = new SocketDriver();
  private readonly process = new ProcessDriver();

  async call<O extends Op>(op: O, params: Params<O>): Promise<Result<O>> {
    if (process.env.DOLLY_LOCAL === "1") return this.process.call(op, params);
    try {
      return await this.socket.call(op, params);
    } catch (error) {
      if (error instanceof NoService) return this.process.call(op, params);
      throw error;
    }
  }
}
