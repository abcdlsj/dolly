import { Code } from "@dolly/protocol";

/** An error with the exit code it should end the run with. */
export class Failure extends Error {
  constructor(
    message: string,
    readonly code: Code = Code.failed,
  ) {
    super(message);
  }
}
