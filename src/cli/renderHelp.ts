/**
 * CLI help text renderer.
 * Receives an explicit output stream instead of using console global.
 */

import { Writable } from "node:stream";

const HELP_TEXT = `
cdb-to-json - CLI-first Yu-Gi-Oh! Card Ingestion Tool

USAGE
  cdb-to-json <command> [inputs...] [options]

COMMANDS
  convert       Convert CDB files to JSON
  inspect       Read metadata without emitting cards
  validate      Validate input database structure
  schema        Print or write JSON Schema for a profile
  help          Show this help message
  version       Show version information

COMMON OPTIONS
  --locale, -l <tag>        Declare source-text locale (e.g., "en")
  --source-namespace <name> Namespace for external IDs (default: "konami")
  --strict, -s              Treat warnings as errors
  --recursive, -R            Traverse directories recursively
  --exclude, -e <glob>       Exclude matching paths (repeatable)
  --follow-symlinks          Follow symbolic links
  --diagnostics <mode>       Diagnostics output: text, json, jsonl, none (default: text)
  --continue-on-error, -C    Continue after database-level failures

CONVERT OPTIONS
  --profile, -p <name>    Output profile: raw, card, source (default: raw)
  --format, -f <format>    Output format: json, jsonl (default: json)
  --output, -o <path>      Output path (- for stdout)
  --split <mode>           Split output: none, database, card (default: auto)
  --merge, -m              Combine card rows from all inputs
  --on-conflict <policy>   Conflict policy: error, first, last (default: error)
  --pretty, -P             Pretty-print JSON output
  --force, -F              Overwrite existing output files
  --include-raw            Include raw rows in normalized profiles

EXAMPLES
  cdb-to-json convert cards.cdb
  cdb-to-json convert ./databases --output ./out
  cdb-to-json convert cards.cdb --format jsonl
  cdb-to-json inspect cards.cdb
  cdb-to-json schema card
  cdb-to-json validate cards.cdb --strict

EXIT CODES
  0   Success
  1   Internal error
  2   Invalid usage
  3   No CDB input found
  4   Validation failure
  5   Card-ID collision
  6   Output error
  7   Partial conversion

PROFILES
  raw     Lossless extraction (cdb.raw/1 schema)
  card    Client-friendly card catalog records (cdb.card/2 schema)
  source  YGO-DSL source records with simulator provenance (ygo.card-source/1 schema)

PROFILE OUTPUT
  card and source currently accept one input database and write to stdout or
  a single --output file. --merge and --split are not yet available for them.

DOCUMENTATION
  https://github.com/lynellf/cdb-to-json
`.trim();

/**
 * Render help text to the given output stream.
 */
export function renderHelp(stdout: Writable): void {
  stdout.write(HELP_TEXT + "\n");
}

/**
 * Render version information.
 */
export function renderVersion(stdout: Writable): void {
  stdout.write("cdb-to-json v2.0.0\n");
}
