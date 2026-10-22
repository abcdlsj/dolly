// pi extension loaded by Studio (`pi -e studio-extension.ts`). It gives the
// agent two tools: `film`, to report progress Studio shows, and `ask`, to put
// one question to the person with a countdown. Studio reads the tool calls
// from pi's RPC stream; the tools themselves only acknowledge.
//
// Parameters are plain JSON Schema so the file needs no imports.

interface ToolResult {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
}

interface Context {
  ui: { select(title: string, options: string[], opts?: { timeout?: number }): Promise<string | undefined> };
}

interface ExtensionAPI {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(id: string, params: never, signal: AbortSignal | undefined, onUpdate: unknown, ctx: Context): Promise<ToolResult>;
  }): void;
}

const MOVES = ["hold", "focus", "frame", "pull-back", "pan-to", "punch-in", "drift", "tour"];

const text = (value: string): ToolResult => ({ content: [{ type: "text", text: value }], details: {} });

export interface FilmParams {
  stage?: "explore" | "direction" | "filming" | "final" | "ready";
  doing?: string;
  screen?: string;
  direction?: { line: string; why: string; alternatives?: string[]; picked?: string[] };
  shots?: { title: string; move: string; action: string; why: string; seconds: number }[];
  shot?: { index: number; state: "live" | "done" | "retake" };
  outputs?: string[];
  frame?: string;
}

export interface AskParams {
  question: string;
  options: string[];
  recommended: number;
  seconds?: number;
  shot?: number;
}

export default function studio(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "film",
    label: "Film",
    description:
      "Tell Studio where the film stands, in plain words the person will read. Call it when the stage changes, after each screen you explore, " +
      "once you settle the direction and shot list, when a shot starts and ends, and with the exported files at the end.",
    parameters: {
      type: "object",
      properties: {
        stage: { type: "string", enum: ["explore", "direction", "filming", "final", "ready"] },
        doing: { type: "string", description: "What you are doing now, under 60 characters, e.g. “Dragging the conflict to Keep both”." },
        screen: { type: "string", description: "Name of a screen you just explored." },
        direction: {
          type: "object",
          properties: {
            line: { type: "string", description: "The one line the film says." },
            why: { type: "string", description: "Two sentences on why, citing what you saw." },
            alternatives: { type: "array", items: { type: "string" } },
            picked: { type: "array", items: { type: "string" }, description: "Screens the film uses." },
          },
          required: ["line", "why"],
        },
        shots: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              move: { type: "string", enum: MOVES },
              action: { type: "string" },
              why: { type: "string" },
              seconds: { type: "number" },
            },
            required: ["title", "move", "action", "why", "seconds"],
          },
        },
        shot: {
          type: "object",
          properties: { index: { type: "number", description: "1-based" }, state: { type: "string", enum: ["live", "done", "retake"] } },
          required: ["index", "state"],
        },
        outputs: { type: "array", items: { type: "string" }, description: "Paths of the exported films." },
        frame: { type: "string", description: "Path of a fresh `dolly snap` of the app, so the person sees what you see." },
      },
    },
    async execute() {
      return text("ok");
    },
  });

  pi.registerTool({
    name: "ask",
    label: "Ask",
    description:
      "Ask the person one short question with 2 or 3 options and your recommendation. With `seconds`, your recommendation is used when time runs out; " +
      "leave it out only when you cannot continue without an answer. Returns the chosen option.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string" },
        options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 },
        recommended: { type: "number", description: "0-based index of your pick." },
        seconds: { type: "number" },
        shot: { type: "number", description: "1-based shot the question is about." },
      },
      required: ["question", "options", "recommended"],
    },
    async execute(_id, params: AskParams, _signal, _onUpdate, ctx) {
      const fallback = params.options[params.recommended] ?? params.options[0] ?? "";
      const choice = await ctx.ui.select(params.question, params.options, params.seconds ? { timeout: params.seconds * 1000 } : undefined);
      return text(choice ?? fallback);
    },
  });
}
