import { describe, expect, it } from "vitest";
import {
  RawEnvelopeOutputLimitError,
  RawEnvelopeSinkError,
  RawEnvelopeStreamWriter,
} from "../../src/profiles/rawEnvelopeWriter.js";

const metadata = {
  fileName: "cards.cdb",
  sha256: "sha256:bundle",
  sizeBytes: 4096,
  extraTables: [{ name: "notes", columns: ["id", "value"], rowCount: 1 }],
};

const datas = {
  id: "9223372036854775807",
  ot: null,
  alias: "0",
  setcode: "1",
  type: "2",
  atk: null,
  def: null,
  level: "4",
  race: "0",
  attribute: "0",
  category: "0",
};

const texts = {
  id: "9223372036854775807",
  name: "Card\nName",
  desc: "Description",
  str1: null,
  str2: null,
  str3: null,
  str4: null,
  str5: null,
  str6: null,
  str7: null,
  str8: null,
  str9: null,
  str10: null,
  str11: null,
  str12: null,
  str13: null,
  str14: null,
  str15: null,
  str16: null,
};

function createWriter(format: "json" | "jsonl" = "json", pretty = false) {
  const chunks: string[] = [];
  const writer = new RawEnvelopeStreamWriter({
    format,
    pretty,
    write: (chunk) => chunks.push(chunk),
  });
  return { writer, chunks, text: () => chunks.join("") };
}

describe("raw envelope streaming writer", () => {
  it("emits fixed metadata and table arrays without collecting rows", () => {
    const output = createWriter();
    output.writer.start(metadata);
    output.writer.writeDatas(datas);
    expect(output.chunks.length).toBeGreaterThan(1);
    output.writer.finishDatas();
    output.writer.writeTexts(texts);
    output.writer.finish();

    const parsed = JSON.parse(output.text());
    expect(parsed.schema).toBe("cdb.raw/1");
    expect(parsed.integerEncoding).toBe("signed-int64-decimal");
    expect(parsed.source.fileName).toBe("cards.cdb");
    expect(parsed.tables.datas).toEqual([datas]);
    expect(parsed.tables.texts).toEqual([texts]);
    expect(parsed.extraTables).toEqual(metadata.extraTables);
  });

  it("emits an empty raw envelope with stable JSONL framing", () => {
    const output = createWriter("jsonl");
    output.writer.start({ ...metadata, extraTables: [] });
    output.writer.finishDatas();
    output.writer.finish();

    const lines = output.text().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).tables).toEqual({ datas: [], texts: [] });
    expect(lines[1]).toBe("");
  });

  it("supports pretty JSON without changing decoded values", () => {
    const output = createWriter("json", true);
    output.writer.start(metadata);
    output.writer.finishDatas();
    output.writer.finish();

    expect(output.text()).toContain("\n  \"schema\":");
    expect(JSON.parse(output.text()).tables).toEqual({ datas: [], texts: [] });
  });

  it("rejects a chunk before it reaches the sink when maxOutputBytes is exceeded", () => {
    const chunks: string[] = [];
    const writer = new RawEnvelopeStreamWriter({
      format: "json",
      maxOutputBytes: 8,
      write: (chunk) => chunks.push(chunk),
    });

    expect(() => writer.start(metadata)).toThrow(RawEnvelopeOutputLimitError);
    expect(chunks).toEqual([]);
    expect(writer.outputBytes).toBe(0);
  });

  it("reserves each encoded chunk and wraps sink failures", () => {
    const reservations: number[] = [];
    let writes = 0;
    const writer = new RawEnvelopeStreamWriter({
      format: "json",
      reserve: (bytes) => {
        reservations.push(bytes);
        return true;
      },
      write: () => {
        writes += 1;
        if (writes === 2) throw new Error("sink closed");
      },
    });

    writer.start(metadata);
    expect(() => writer.finishDatas()).toThrow(RawEnvelopeSinkError);
    expect(reservations.length).toBe(2);
    expect(reservations.every((bytes) => bytes > 0)).toBe(true);
  });
});
