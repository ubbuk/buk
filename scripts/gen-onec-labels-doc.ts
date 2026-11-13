// docs/onec-labels-mn.md-ийг lib/onec-odata/labels-mn.ts-ээс дахин үүсгэнэ:  npm run onec:labels-doc
import { writeFileSync } from "node:fs";
import { renderLabelsDoc } from "../lib/onec-odata/labels-doc";

writeFileSync(new URL("../docs/onec-labels-mn.md", import.meta.url), renderLabelsDoc(), "utf8");
console.log("docs/onec-labels-mn.md шинэчлэгдлээ");
