// Asserts the app enables "Check" only for input the contract accepts (run: node app/check-actions.mjs app/index.html).
import { readFileSync } from "node:fs";
const html = readFileSync(process.argv[2], "utf8");
const js = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const body = js.slice(js.indexOf("const URL_RE"), js.indexOf("const fields"));
const make = new Function("ctx", `let me = ctx.me; ${body}; return problem;`);
const ok = { quote: "Try not to become a man of success.", speaker: "Albert Einstein", source: "https://quotes.toscrape.com/page/1/", used_in: "" };
const run = (f, me = "0xa") => make({ me })({ ...ok, ...f });
const check = (name, good) => { console.log(good ? "ok  " : "FAIL", name); if (!good) process.exitCode = 1; };

check("valid input enables Check", run({}) === "");
check("no wallet: disabled with a prompt", run({}, null).includes("Connect"));
check("quote under 10 characters after trimming quote marks", run({ quote: '"  short  "' }) !== "");
check("quote over 600 characters", run({ quote: "x".repeat(601) }) !== "");
check("one-letter speaker", run({ speaker: " A " }) !== "");
check("plain http source", run({ source: "http://quotes.toscrape.com/" }) !== "");
check("source without a domain", run({ source: "https://localhost/x" }) !== "");
check("bad published-in URL", run({ used_in: "example.com/a" }) !== "");
check("https published-in is fine", run({ used_in: "https://example.com/a" }) === "");
