// Entry point for the AURA server inside the desktop app.
// Same server as `npm run serve`, plus one rule: exit when the desktop app goes away.
// The app keeps this process's stdin open; if the app is closed, crashes or is killed,
// the pipe closes and the server stops instead of lingering with the database open.
import { start } from "../server/index.mjs";

const leave = () => process.exit(0);
process.stdin.on("end", leave);
process.stdin.on("close", leave);
process.stdin.on("error", leave);
process.stdin.resume();

await start();
