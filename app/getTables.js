import Database from "better-sqlite3";
import { resolve } from "node:path";

/**
 * @param {string} path
 * @returns
 */
function getAllTables(path) {
  try {
    console.log("loading file at:", path);
    console.log("Resolved full path:", resolve(path));
    const db = new Database(path);
    console.log("successfully loaded database");
    console.log("getting tables...");
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
      )
      .all();
    console.log("successfully got tables...");
    const result = {};

    for (const table of tables) {
      result[table.name] = db.prepare(`SELECT * FROM ${table.name}`).all();
    }

    return result;
  } catch (error) {
    throw new Error(`Failed to parse database: ${error.message}`);
  }
}

/**
 *
 * @param {string} path
 * @returns
 */
export default async function getFile(path) {
  return await getAllTables(path);
}
