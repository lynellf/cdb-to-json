import { readdir } from "fs";

/**
 * @param {string} path
 * @returns
 */
export default function getDirectory(path) {
  return new Promise((resolve, reject) => {
    readdir(path, (err, files) => {
      if (err) reject(err);
      resolve(
        files
          .filter((filename) => filename.includes(".cdb"))
          .map((filename) => ({
            name: filename.split(".")[0],
            path: `${path}/${filename}`,
          }))
      );
    });
  });
}
