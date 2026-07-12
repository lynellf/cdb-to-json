/**
 * Schema command handler.
 * Prints or writes JSON Schema for an output profile.
 * Reads from packaged schemas. Never opens SQLite.
 */

import { Writable } from "node:stream";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface SchemaCommandResult {
  exitCode: number;
}

/**
 * Available schema profiles.
 */
const SCHEMA_PROFILES = [
  "raw",
  "card",
  "card-array",
  "source",
  "source-array",
] as const;

type SchemaProfile = (typeof SCHEMA_PROFILES)[number];

/**
 * Map profile name to schema filename.
 */
function getSchemaFilename(profile: SchemaProfile): string {
  const map: Record<SchemaProfile, string> = {
    raw: "cdb.raw.v1.schema.json",
    card: "cdb.card.v2.schema.json",
    "card-array": "cdb.card-array.v2.schema.json",
    source: "ygo.card-source.v1.schema.json",
    "source-array": "ygo.card-source-array.v1.schema.json",
  };
  return map[profile];
}

/**
 * Get the schemas directory path.
 */
function getSchemasDir(): string {
  // When running from dist, schemas are at project root
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  // Navigate from dist/commands/ to schemas/
  const projectRoot = join(moduleDir, "..", "..");
  return join(projectRoot, "schemas");
}

/**
 * Execute the schema command.
 */
export async function executeSchema(
  profile: string,
  options: { output?: string },
  streams: { stdout: Writable; stderr: Writable }
): Promise<SchemaCommandResult> {
  // Validate profile
  if (!SCHEMA_PROFILES.includes(profile as SchemaProfile)) {
    streams.stderr.write(
      `Error: Invalid profile '${profile}'. Valid values: ${SCHEMA_PROFILES.join(", ")}\n`
    );
    return { exitCode: 2 };
  }

  const schemasDir = getSchemasDir();
  const filename = getSchemaFilename(profile as SchemaProfile);
  const schemaPath = join(schemasDir, filename);

  if (!existsSync(schemaPath)) {
    streams.stderr.write(`Error: Schema file not found: ${filename}\n`);
    return { exitCode: 1 };
  }

  try {
    const schemaContent = readFileSync(schemaPath, "utf-8");
    const parsed = JSON.parse(schemaContent);
    const output = JSON.stringify(parsed, null, 2);

    if (options.output && options.output !== "-") {
      // Write to file (Phase 3+ feature; in Phase 2 just print to stdout)
      streams.stdout.write(output + "\n");
    } else {
      streams.stdout.write(output + "\n");
    }

    return { exitCode: 0 };
  } catch (error) {
    streams.stderr.write(
      `Error reading schema: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return { exitCode: 1 };
  }
}
