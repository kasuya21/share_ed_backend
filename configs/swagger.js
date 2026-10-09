import { readFileSync } from "node:fs";

const swaggerUrl = new URL("../swagger.json", import.meta.url);

export const swaggerDocument = JSON.parse(readFileSync(swaggerUrl, "utf8"));
