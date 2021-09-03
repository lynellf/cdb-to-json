const sqlite3 = require("sqlite3");
const sqliteToJson = require("sqlite-to-json");

function getAllTables(path: string) {
  return new Promise((resolve, reject) => {
    const exporter = new sqliteToJson({
      client: new sqlite3.Database(path),
    });
    exporter.all((err: Error, data: unknown) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

export default async function getFile(path: string) {
  return await getAllTables(path);
}
