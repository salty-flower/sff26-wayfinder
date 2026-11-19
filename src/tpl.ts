/** Shared nunjucks environment. Every piece of HTML and SVG structure lives in templates/. */
import nunjucks from "nunjucks";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");

export const tpl = new nunjucks.Environment(new nunjucks.FileSystemLoader(join(ROOT, "templates")), {
  autoescape: true,
  trimBlocks: true,
  lstripBlocks: true,
  throwOnUndefined: false,
});

tpl.addFilter("json", (value: unknown) =>
  // Safe inside <script type="application/json">.
  new nunjucks.runtime.SafeString(JSON.stringify(value).replace(/</g, "\\u003c")),
);
