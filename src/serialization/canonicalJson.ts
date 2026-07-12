/**
 * Deterministic canonical JSON serialization.
 *
 * Produces stable, deterministic JSON output with UTF-8 encoding,
 * LF line endings, compact by default, and two-space pretty mode.
 *
 * Object property order follows insertion order and MUST be
 * controlled by the caller to remain deterministic.
 * Hash canonicalization uses sorted keys separately from
 * the profile output contract.
 */

/**
 * Options for canonical JSON serialization.
 */
export interface CanonicalJsonOptions {
  /** Pretty-print with two-space indentation */
  pretty?: boolean;
  /** Maximum nesting depth before throwing */
  maxDepth?: number;
}

const DEFAULT_OPTIONS: Required<CanonicalJsonOptions> = {
  pretty: false,
  maxDepth: 256,
};

/**
 * Internal recursive serializer.
 */
function serializeValue(
  val: unknown,
  depth: number,
  indent: string,
  opts: Required<CanonicalJsonOptions>,
  seen: WeakSet<object>
): string {
  if (depth > opts.maxDepth) {
    throw new Error("Max serialization depth exceeded");
  }

  if (val === null) return "null";
  if (val === undefined) return "null";

  if (typeof val === "boolean") return String(val);
  if (typeof val === "number") {
    if (!Number.isFinite(val)) {
      throw new Error(
        `Cannot serialize non-finite value: ${val}`
      );
    }
    return String(val);
  }
  if (typeof val === "bigint") {
    return `"${val.toString()}"`;
  }
  if (typeof val === "string") {
    return serializeString(val);
  }

  if (typeof val === "object") {
    if (seen.has(val)) {
      throw new Error("Circular reference detected");
    }
    seen.add(val);

    try {
      if (Array.isArray(val)) {
        return serializeArray(val, depth, indent, opts, seen);
      }
      return serializeObject(val as Record<string, unknown>, depth, indent, opts, seen);
    } finally {
      seen.delete(val);
    }
  }

  // Symbol, function, etc. — throw
  throw new Error(
    `Cannot serialize value of type ${typeof val}`
  );
}

/**
 * Serialize a value to canonical JSON string.
 * Uses compact format by default, two-space indent when pretty is true.
 * LF line endings, no trailing whitespace, final newline.
 *
 * Throws if value contains non-finite numbers, circular references,
 * or exceeds max depth.
 */
export function serializeJson(
  value: unknown,
  options: CanonicalJsonOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const seen = new WeakSet<object>();
  return serializeValue(value, 0, "", opts, seen);
}

/**
 * Serialize a string with proper JSON escaping.
 */
function serializeString(str: string): string {
  // Fast path for simple strings
  let result = '"';
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    switch (ch) {
      case 0x08:
        result += "\\b";
        break;
      case 0x09:
        result += "\\t";
        break;
      case 0x0a:
        result += "\\n";
        break;
      case 0x0c:
        result += "\\f";
        break;
      case 0x0d:
        result += "\\r";
        break;
      case 0x22:
        result += '\\"';
        break;
      case 0x5c:
        result += "\\\\";
        break;
      default:
        if (ch < 0x20) {
          result += `\\u${ch.toString(16).padStart(4, "0")}`;
        } else {
          result += str[i];
        }
        break;
    }
  }
  result += '"';
  return result;
}

/**
 * Serialize an array to JSON.
 */
function serializeArray(
  arr: unknown[],
  depth: number,
  indent: string,
  opts: Required<CanonicalJsonOptions>,
  seen: WeakSet<object>
): string {
  if (arr.length === 0) return "[]";

  if (opts.pretty) {
    const innerIndent = indent + "  ";
    const items = arr.map((item) => {
      const inner = serializeValue(item, depth + 1, innerIndent, opts, seen);
      return `${innerIndent}${inner}`;
    });
    return `[\n${items.join(",\n")}\n${indent}]`;
  }

  const items = arr.map((item) => serializeValue(item, depth + 1, indent, opts, seen));
  return `[${items.join(",")}]`;
}

/**
 * Serialize a plain object to JSON using insertion-order keys.
 */
function serializeObject(
  obj: Record<string, unknown>,
  depth: number,
  indent: string,
  opts: Required<CanonicalJsonOptions>,
  seen: WeakSet<object>
): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{}";

  if (opts.pretty) {
    const innerIndent = indent + "  ";
    const items = keys.map((key) => {
      const val = serializeValue(obj[key], depth + 1, innerIndent, opts, seen);
      return `${innerIndent}${serializeString(key)}: ${val}`;
    });
    return `{\n${items.join(",\n")}\n${indent}}`;
  }

  const items = keys.map((key) => {
    const val = serializeValue(obj[key], depth + 1, indent, opts, seen);
    return `${serializeString(key)}:${val}`;
  });
  return `{${items.join(",")}}`;
}

/**
 * Produce a canonical hash serialization with sorted keys.
 * This is used for content hashing, not for profile output.
 * The output is always compact JSON with sorted object keys.
 */
export function hashCanonicalJson(value: unknown): string {
  return hashSerialize(value, new WeakSet());
}

function hashSerialize(
  val: unknown,
  seen: WeakSet<object>
): string {
  if (val === null) return "null";
  if (val === undefined) return "null";
  if (typeof val === "boolean") return String(val);
  if (typeof val === "number") {
    if (!Number.isFinite(val)) {
      throw new Error(`Cannot hash non-finite value: ${val}`);
    }
    return String(val);
  }
  if (typeof val === "bigint") return `"${val.toString()}"`;
  if (typeof val === "string") return serializeString(val);

  if (typeof val === "object") {
    if (seen.has(val)) {
      throw new Error("Circular reference in hash canonicalization");
    }
    seen.add(val);

    try {
      if (Array.isArray(val)) {
        const items = val.map((item) => hashSerialize(item, seen));
        return `[${items.join(",")}]`;
      }

      const keys = Object.keys(val).sort();
      const items = keys.map((key) => {
        const inner = hashSerialize((val as Record<string, unknown>)[key], seen);
        return `${serializeString(key)}:${inner}`;
      });
      return `{${items.join(",")}}`;
    } finally {
      seen.delete(val);
    }
  }

  throw new Error(`Cannot hash value of type ${typeof val}`);
}