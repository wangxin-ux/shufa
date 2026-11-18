import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { requireSeries } from "./operator-series-admission";

export function seriesContract(root: string) {
  const dependencies = createRequire(
    createRequire(
      createRequire(__filename).resolve("@nestjs/cli/package.json"),
    ).resolve("@angular-devkit/core"),
  );
  type Validate = ((value: unknown) => boolean) & { errors: unknown };
  const { default: Ajv } = dependencies("ajv/dist/2020") as {
    default: new (options: object) => {
      addSchema(value: unknown, id: string): void;
      getSchema(ref: string): Validate;
    };
  };
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  (dependencies("ajv-formats") as (instance: typeof ajv) => void)(ajv);
  const base = "https://education.invalid/f02/";
  const dir = resolve(root, "contracts");
  const documents = new Map<string, unknown>();
  for (const file of readdirSync(dir).filter((name) =>
    name.endsWith(".yaml"),
  )) {
    const document = load(readFileSync(resolve(dir, file), "utf8"));
    documents.set(base + file, document);
    ajv.addSchema(document, base + file);
  }
  return (
    section: "preview" | "create" | "cancellationPreview" | "cancel",
    status: number,
    body: unknown,
  ) => {
    let response = `${base}operator-lesson-series.openapi.yaml#/${section}/post/responses/${status}`;
    for (let depth = 0; depth < 12; depth++) {
      const [file, pointer] = response.split("#");
      const node = (pointer ?? "")
        .split("/")
        .slice(1)
        .reduce<unknown>(
          (value, key) =>
            value && typeof value === "object"
              ? (value as Record<string, unknown>)[
                  key.replace(/~1/g, "/").replace(/~0/g, "~")
                ]
              : undefined,
          documents.get(file),
        );
      requireSeries(
        node && typeof node === "object",
        "OpenAPI response pointer missing",
      );
      const reference = (node as { $ref?: string }).$ref;
      if (!reference) break;
      response = new URL(reference, file).toString();
      requireSeries(depth < 11, "cyclic OpenAPI response reference");
    }
    const ref = ajv.getSchema(`${response}/content/application~1json/schema`);
    requireSeries(ref, "OpenAPI response schema missing");
    const original = JSON.stringify(body);
    requireSeries(
      ref(body),
      `OpenAPI response ${section}/${status}: ${JSON.stringify(ref.errors)}`,
    );
    requireSeries(
      JSON.stringify(body) === original,
      "OpenAPI validator mutated response",
    );
  };
}
