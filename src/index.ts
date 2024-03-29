import getTables from "./getTables";
import getDirectory from "./getDirectory";
import { writeFileSync } from "fs";

type Options = {
  emit?: boolean;
  ignore?: string[]; // list of files to ignore
};

export default async function mod(
  inputDir: string,
  outputDir: string | undefined,
  options: Options = { emit: true, ignore: [] },
) {
  const files = await getDirectory(inputDir).then((fileList) =>
    fileList.filter((file) => !(options?.ignore ?? []).includes(file.name))
  ).catch(console.error);
  if (files) {
    const tables = await Promise.all(
      files.map(async (file) => ({
        data: await getTables(file.path),
        name: file.name,
      })),
    );

    if (outputDir) {
      tables.forEach((table) =>
        writeFileSync(
          `${outputDir}/${table.name}.json`,
          JSON.stringify(table.data),
        )
      );
    }

    if (options.emit) {
      return tables;
    }
  }
}
