/**
 * Generic pilot consumer fixture.
 *
 * A minimal consumer that validates source documents from JSON/JSONL
 * without importing SQLite, src/cdb, or any bespoke CDB adapter.
 *
 * Per P5-AC3:
 * - Imports only schemas and JSON parsing
 * - Validates each document against the frozen schema
 * - Asserts every document is SOURCE_ONLY with no scripts/rulings
 * - Returns validation results for the 64-record pilot corpus
 *
 * @module fixtures/pilotConsumer
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";
import sourceSchema from "../../schemas/ygo.card-source.v1.schema.json";
import sourceAggregateSchema from "../../schemas/ygo.card-source-array.v1.schema.json";

export interface PilotValidationResult {
  valid: boolean;
  errors: string[];
  documentCount: number;
  sourceOnlyCount: number;
  hasScriptsOrRulings: string[];
  missingRequiredFields: string[];
  schemaViolations: string[];
}

/**
 * Create a schema validator for source documents.
 * Uses Ajv with formats, validates against the frozen schema.
 */
export function createSourceValidator(): Ajv {
  const instance = new Ajv({
    allErrors: true,
    strict: false,
    validateSchema: false,
  });
  addFormats(instance);
  instance.addSchema(sourceSchema);
  return instance;
}

/**
 * Validate a single source document against the schema.
 */
export function validateSourceDocument(
  doc: unknown,
  validator: Ajv,
): { valid: boolean; errors: string[] } {
  const validate = validator.compile(sourceSchema);
  const valid = validate(doc);
  const errors: string[] = [];

  if (!valid && validate.errors) {
    for (const err of validate.errors) {
      errors.push(`${err.instancePath}: ${err.message}`);
    }
  }

  return { valid: !!valid, errors };
}

/**
 * Check if a document has SOURCE_ONLY coverage and empty scripts/rulings.
 */
export function checkSourceOnly(doc: unknown): { isSourceOnly: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!doc || typeof doc !== "object") {
    return { isSourceOnly: false, issues: ["Document is not an object"] };
  }

  const d = doc as Record<string, unknown>;

  // Check coverage.status
  if (!d.coverage || typeof d.coverage !== "object") {
    issues.push("Missing coverage object");
  } else {
    const cov = d.coverage as Record<string, unknown>;
    if (cov.status !== "SOURCE_ONLY") {
      issues.push(`coverage.status is '${cov.status}', expected 'SOURCE_ONLY'`);
    }
  }

  // Check references
  if (!d.references || typeof d.references !== "object") {
    issues.push("Missing references object");
  } else {
    const refs = d.references as Record<string, unknown>;
    if (Array.isArray(refs.scripts) && refs.scripts.length > 0) {
      issues.push("scripts is not empty");
    }
    if (Array.isArray(refs.rulings) && refs.rulings.length > 0) {
      issues.push("rulings is not empty");
    }
  }

  return { isSourceOnly: issues.length === 0, issues };
}

/**
 * Validate a single source document comprehensively.
 */
export function validateSingleDocument(doc: unknown): PilotValidationResult {
  const validator = createSourceValidator();
  const { valid, errors } = validateSourceDocument(doc, validator);
  const { isSourceOnly, issues } = checkSourceOnly(doc);

  const allErrors = [
    ...errors,
    ...issues,
  ];

  return {
    valid: valid && isSourceOnly,
    errors: allErrors,
    documentCount: 1,
    sourceOnlyCount: isSourceOnly ? 1 : 0,
    hasScriptsOrRulings: issues.filter((i) =>
      i.includes("scripts") || i.includes("rulings")
    ),
    missingRequiredFields: [],
    schemaViolations: errors,
  };
}

/**
 * Validate a JSON array of source documents.
 */
export function validateJsonArray(jsonString: string): PilotValidationResult {
  let docs: unknown[];
  try {
    docs = JSON.parse(jsonString);
  } catch (e) {
    return {
      valid: false,
      errors: [`JSON parse error: ${e}`],
      documentCount: 0,
      sourceOnlyCount: 0,
      hasScriptsOrRulings: [],
      missingRequiredFields: [],
      schemaViolations: [],
    };
  }

  if (!Array.isArray(docs)) {
    return {
      valid: false,
      errors: ["Root is not an array"],
      documentCount: 0,
      sourceOnlyCount: 0,
      hasScriptsOrRulings: [],
      missingRequiredFields: [],
      schemaViolations: [],
    };
  }

  // Validate aggregate schema
  const validator = createSourceValidator();
  const aggregateValidate = validator.compile(sourceAggregateSchema);
  const aggregateValid = aggregateValidate(docs);
  const aggregateErrors: string[] = [];

  if (!aggregateValid && aggregateValidate.errors) {
    for (const err of aggregateValidate.errors) {
      aggregateErrors.push(`[aggregate] ${err.instancePath}: ${err.message}`);
    }
  }

  // Validate each document
  let sourceOnlyCount = 0;
  const allErrors: string[] = [];
  const hasScriptsOrRulings: string[] = [];
  const missingRequiredFields: string[] = [];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const { valid, errors } = validateSourceDocument(doc, validator);
    const { isSourceOnly, issues } = checkSourceOnly(doc);

    if (isSourceOnly) {
      sourceOnlyCount++;
    }

    if (!valid) {
      for (const err of errors) {
        allErrors.push(`[doc ${i}] ${err}`);
      }
    }

    for (const issue of issues) {
      if (issue.includes("scripts") || issue.includes("rulings")) {
        hasScriptsOrRulings.push(`[doc ${i}]: ${issue}`);
      } else {
        missingRequiredFields.push(`[doc ${i}]: ${issue}`);
      }
    }
  }

  return {
    valid: aggregateValid && sourceOnlyCount === docs.length,
    errors: [...aggregateErrors, ...allErrors],
    documentCount: docs.length,
    sourceOnlyCount,
    hasScriptsOrRulings,
    missingRequiredFields,
    schemaViolations: allErrors,
  };
}

/**
 * Validate a JSONL string of source documents (one JSON object per line).
 */
export function validateJsonl(jsonlString: string): PilotValidationResult {
  const lines = jsonlString.split("\n").filter((line) => line.trim() !== "");
  const docs: unknown[] = [];

  // Parse each line
  const parseErrors: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      docs.push(JSON.parse(lines[i]));
    } catch (e) {
      parseErrors.push(`[line ${i + 1}]: JSON parse error: ${e}`);
    }
  }

  if (parseErrors.length > 0) {
    return {
      valid: false,
      errors: parseErrors,
      documentCount: 0,
      sourceOnlyCount: 0,
      hasScriptsOrRulings: [],
      missingRequiredFields: [],
      schemaViolations: [],
    };
  }

  // Validate aggregate schema
  const validator = createSourceValidator();
  const aggregateValidate = validator.compile(sourceAggregateSchema);
  const aggregateValid = aggregateValidate(docs);
  const aggregateErrors: string[] = [];

  if (!aggregateValid && aggregateValidate.errors) {
    for (const err of aggregateValidate.errors) {
      aggregateErrors.push(`[aggregate] ${err.instancePath}: ${err.message}`);
    }
  }

  // Validate each document
  let sourceOnlyCount = 0;
  const allErrors: string[] = [];
  const hasScriptsOrRulings: string[] = [];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const { valid, errors } = validateSourceDocument(doc, validator);
    const { isSourceOnly, issues } = checkSourceOnly(doc);

    if (isSourceOnly) {
      sourceOnlyCount++;
    }

    if (!valid) {
      for (const err of errors) {
        allErrors.push(`[doc ${i}] ${err}`);
      }
    }

    for (const issue of issues) {
      if (issue.includes("scripts") || issue.includes("rulings")) {
        hasScriptsOrRulings.push(`[doc ${i}]: ${issue}`);
      }
    }
  }

  return {
    valid: aggregateValid && sourceOnlyCount === docs.length,
    errors: [...aggregateErrors, ...allErrors],
    documentCount: docs.length,
    sourceOnlyCount,
    hasScriptsOrRulings,
    missingRequiredFields: [],
    schemaViolations: allErrors,
  };
}

/**
 * Validate pilot corpus from a file path (reads JSON or JSONL by extension).
 */
export function validatePilotFile(filePath: string): PilotValidationResult {
  const { readFileSync } = require("node:fs");
  const content = readFileSync(filePath, "utf-8");

  if (filePath.endsWith(".jsonl")) {
    return validateJsonl(content);
  } else {
    return validateJsonArray(content);
  }
}
