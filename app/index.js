import { writeFileSync } from "fs";
import getTables from "./getTables.js";
import getDirectory from "./getDirectory.js";

/**
 * @typedef {object} Options
 * @property {boolean} [Options.emit] returns the tables instead of serializing into JSON
 * @property {string[]} [Options.ignore] list of files to ignore
 * @param {string} inputDir
 * @param {string} outputDir
 * @param {object} options
 * @returns
 */
export default async function mod(
  inputDir,
  outputDir,
  options = { emit: true, ignore: [] }
) {
  try {
    const files = await getDirectory(inputDir)
      .then((fileList) =>
        fileList.filter((file) => !(options?.ignore ?? []).includes(file.name))
      )
      .catch(() => []);

    if (!files.length) {
      throw new Error("No databases found.");
    }

    if (files) {
      const tables = await Promise.all(
        files.map(async (file) => ({
          data: await getTables(file.path),
          name: file.name,
        }))
      );

      if (outputDir) {
        tables.forEach((table) =>
          writeFileSync(
            `${outputDir}/${table.name}.json`,
            JSON.stringify(table.data)
          )
        );
      }

      if (options.emit) {
        return tables;
      }
    }
  } catch (error) {
    throw new Error(`Failed to parse databases: ${error.message}`);
  }
}
