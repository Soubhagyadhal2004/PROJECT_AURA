// node --import ./eval/lib/register.mjs eval/<script>.mjs
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
