import { z } from "zod";
import type { ToolDef } from "./types";

/** JSON-Schema der Eingabe (ohne $schema-Zeile) – für die Claude-API und MCP gleich. */
export function inputSchema(t: Pick<ToolDef, "input">): Record<string, unknown> {
  const js = z.toJSONSchema(t.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  if (!js.type) js.type = "object";
  if (js.type === "object" && !js.properties) js.properties = {};
  return js;
}

