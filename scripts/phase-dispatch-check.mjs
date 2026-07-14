#!/usr/bin/env node

/**
 * Fail-closed phase dispatcher.
 *
 * P3/P4 may only be routed after the machine contract, current status,
 * authoritative scripts, named P1/P2 test files, and the complete focused
 * command set agree. A successful run records fresh evidence; a partial run
 * never creates an acceptance record.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(
  repositoryRoot,
  "docs/cdb-to-json-cli-refactor/execution-contract.json",
);
const statusPath = join(repositoryRoot, "docs/implementation/current.md");
const evidencePath = join(
  repositoryRoot,
  "docs/cdb-to-json-cli-refactor/evidence/p1-p2-gate.json",
);

const requiredScripts = [
  "build:native",
  "build",
  "test:fixtures",
  "test:unit",
  "test:reader",
  "test:api",
  "test:compat",
  "test:cli",
  "test:conformance",
  "test:normalization",
  "test:source",
  "test:streaming",
  "test",
  "package:check",
  "phase:dispatch:p3",
  "phase:dispatch:p4",
];

const requiredTestFiles = [
  "tests/cli/exitCodes.test.ts",
  "tests/cli/limitRelations.test.ts",
  "tests/cli/nativeCapabilityCleanup.test.ts",
  "tests/reader/discovery.test.ts",
  "tests/reader/joinDiagnostics.test.ts",
  "tests/reader/largeJoin.test.ts",
  "tests/reader/resourceLimits.test.ts",
  "tests/reader/extraTableLimits.test.ts",
  "tests/reader/textByteFidelity.test.ts",
  "tests/reader/walMaterialization.test.ts",
  "tests/reader/physicalSnapshotProvenance.test.ts",
  "tests/reader/sourceMemberSwap.test.ts",
  "tests/reader/sourceParentSwap.test.ts",
  "tests/reader/sourceSameInodeMutation.test.ts",
  "tests/reader/materializationQuota.test.ts",
  "tests/reader/stagingSnapshotBudget.test.ts",
  "tests/api/iterateRawCards.test.ts",
  "tests/api/iterateRawCards.types.test.ts",
  "tests/compatibility/legacy.test.ts",
  "tests/compatibility/legacy-output.test.ts",
  "tests/compatibility/legacyNames.test.ts",
  "tests/compatibility/legacyOutputSecurity.test.ts",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runCommand(command) {
  const started = Date.now();
  try {
    const output = execFileSync("bash", ["-lc", command], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      command,
      exitStatus: 0,
      durationMs: Date.now() - started,
      outputTail: output.slice(-2000),
    };
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    return {
      command,
      exitStatus: typeof error.status === "number" ? error.status : 1,
      durationMs: Date.now() - started,
      outputTail: `${stdout}${stderr}`.slice(-2000),
    };
  }
}

function fail(messages) {
  console.error("Phase dispatch blocked:");
  for (const message of messages) console.error(`- ${message}`);
  process.exitCode = 1;
}

const target = process.argv[2];
if (target !== "P3" && target !== "P4") {
  fail(["usage: node scripts/phase-dispatch-check.mjs P3|P4"]);
} else {
  const errors = [];
  let contract;
  let packageJson;

  try {
    contract = readJson(contractPath);
    packageJson = readJson(join(repositoryRoot, "package.json"));
  } catch (error) {
    errors.push(`cannot read machine contract or package metadata: ${error.message}`);
  }

  if (contract) {
    if (contract.revision < 12) {
      errors.push(`execution contract revision ${contract.revision} is older than Revision 12`);
    }
    if (!contract.revision_12_remediation) {
      errors.push("Revision-12 remediation is missing from execution-contract.json");
    }
    if (!contract.source_artifacts.includes("docs/cdb-to-json-cli-refactor/phase-r11-enforcement-and-gates.md")) {
      errors.push("phase-r11-enforcement-and-gates.md is not listed as a source artifact");
    }
  }

  const status = existsSync(statusPath) ? readFileSync(statusPath, "utf8") : "";
  if (!status.includes("Phase 0-1 — BLOCKED")) {
    errors.push("docs/implementation/current.md does not retain the P1/P2 blocked status");
  }
  if (/^## Phase [23].*\b(?:COMPLETE|ACCEPTED)\b/im.test(status)) {
    errors.push("implementation status contains an unaccepted Phase 2/3 completion claim");
  }

  const scripts = packageJson?.scripts ?? {};
  for (const name of requiredScripts) {
    if (typeof scripts[name] !== "string") {
      errors.push(`missing required npm script: ${name}`);
    }
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (name.startsWith("test:") && command.includes("--passWithNoTests")) {
      errors.push(`authoritative test script ${name} uses --passWithNoTests`);
    }
  }

  for (const path of requiredTestFiles) {
    if (!existsSync(join(repositoryRoot, path))) {
      errors.push(`missing named P1/P2 test file: ${path}`);
    }
  }

  if (errors.length > 0) {
    fail(errors);
  } else {
    const configuredCommands = contract.revision_12_remediation.required_commands;
    const commands = configuredCommands.filter(
      (command) => !command.startsWith("npm run phase:dispatch:"),
    );
    const results = commands.map(runCommand);
    const failedCommands = results.filter((result) => result.exitStatus !== 0);

    if (failedCommands.length > 0) {
      fail(
        failedCommands.map(
          (result) => `${result.command} exited ${result.exitStatus}`,
        ),
      );
    } else {
      const manifestPath = join(repositoryRoot, "dist/native/capability.json");
      const evidence = {
        schema: "cdb-to-json/p1-p2-gate-evidence/1",
        target,
        contractRevision: contract.revision,
        status: "PASS",
        recordedAt: new Date().toISOString(),
        testFiles: requiredTestFiles,
        commands: results,
        buildIdentity: {
          packageVersion: packageJson.version,
          nodeVersion: process.version,
          capabilityManifestSha256: existsSync(manifestPath)
            ? sha256(manifestPath)
            : null,
        },
      };
      mkdirSync(dirname(evidencePath), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
      console.log(`Phase dispatch ${target} permitted; evidence written to ${evidencePath}`);
    }
  }
}
