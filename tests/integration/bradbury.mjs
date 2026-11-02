// End-to-end on Testnet Bradbury (Phase 2), on the packed code that is deployed:
//
//   python deploy/shrink.py contracts/quote_check.py build/quote_check.py --pack
//   npm i genlayer-js@2.0.0-rc.2   # plus the estimateTransactionFees patch in app/README.md
//   GL_PK0=0x... GL_PK1=0x... node tests/integration/bradbury.mjs build/quote_check.py [contract]
//
// No value moves, so every transaction is only waited on until validators decide (~20 min total).
// The source is quotes.toscrape.com/page/1/, a public sandbox page that does not change; validators
// fetch it live. Covers, with real validators: verbatim, paraphrased, distorted, misattributed and
// absent quotes; a source that does not exist (404) and a plain-http source revert; lookup.
// Every transaction carries a fee deposit from estimateTransactionFees.
import { readFileSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const SRC = "https://quotes.toscrape.com/page/1/";
const SRC_SHA = "efdc2605a2062dceb335ba421bd61d3a6795fb88bfa9873096ecd4a9406de1e3";
const ARTICLE = "https://example.com/opinion/why-we-think";
// rpc.testnet-chain.genlayer.com (the chain default) does not serve gen_call; this one serves the same chain.
const endpoint = "https://rpc-bradbury.genlayer.com";
const a0 = createAccount(process.env.GL_PK0);
const a1 = createAccount(process.env.GL_PK1);
const c0 = createClient({ chain: testnetBradbury, endpoint, account: a0 });
const c1 = createClient({ chain: testnetBradbury, endpoint, account: a1 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flaky = (e) => /fetch failed|ECONNRESET|timed out|socket|not valid JSON|terminated|unknown RPC error/i.test(`${e?.shortMessage} ${e?.details} ${e?.message}`);

async function retry(f) {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (i >= 5 || !flaky(e)) throw e;
      await sleep(10000);
    }
  }
}
const fees = (c) => retry(async () => {
  const e = await c.estimateTransactionFees({});
  return { distribution: e.distribution, feeValue: e.feeValue };
});
// The public RPC drops connections now and then; retry the wait, never the write.
const wait = (c, hash) => retry(() => c.waitForTransactionReceipt({ hash, waitUntil: "decided", interval: 5000, retries: 240 }));
const check = (ok, what) => {
  console.log(ok ? "  ok  " : "  FAIL", what);
  if (!ok) process.exit(1);
};
let address;
// A leader timeout (NOT_VOTED) executed nothing, so sending the call again is safe.
async function tx(c, label, functionName, args) {
  for (let i = 0; ; i++) {
    const hash = await c.writeContract({ address, functionName, args, value: 0n, fees: await fees(c) });
    const r = await wait(c, hash);
    console.log(`${label}: ${hash} ${r.txExecutionResultName}`);
    if (r.txExecutionResultName !== "NOT_VOTED" || i >= 2) return r;
  }
}
const plain = (x) => (x instanceof Map ? Object.fromEntries([...x].map(([k, y]) => [k, plain(y)])) : Array.isArray(x) ? x.map(plain) : typeof x === "bigint" ? Number(x) : x);
const read = async (functionName, args = []) => plain(await retry(() => c0.readContract({ address, functionName, args })));

address = process.argv[3];
if (!address) {
  const hash = await c0.deployContract({ code: readFileSync(process.argv[2], "utf8"), args: [], fees: await fees(c0) });
  const r = await wait(c0, hash);
  address = r.txDataDecoded?.contractAddress;
  console.log(`deploy: ${hash} ${r.txExecutionResultName} -> ${address}`);
  check(r.txExecutionResultName === "FINISHED_WITH_RETURN", "deployed");
}

// Refused before any fetch, and a source that does not exist.
let r = await tx(c1, "plain http source", "check", ["Try not to become a man of success.", "Albert Einstein", "http://quotes.toscrape.com/page/1/", ""]);
check(r.txExecutionResultName === "FINISHED_WITH_ERROR", "plain http source reverts");
r = await tx(c1, "missing source (404)", "check", ["Try not to become a man of success.", "Albert Einstein", "https://quotes.toscrape.com/nope", ""]);
check(r.txExecutionResultName === "FINISHED_WITH_ERROR", "unavailable source reverts, nothing stored");
const start = await read("get_count");

const cases = [
  ["verbatim", c0, "“The world as we have created it is a process of our thinking. It cannot be changed without changing our thinking.”", "Albert Einstein", "VERBATIM"],
  ["paraphrase", c1, "Rather than trying to become a man of success, become a man of value.", "Albert Einstein", "PARAPHRASED"],
  ["cut quote", c1, "Try to become a man of success.", "Albert Einstein", "DISTORTED"],
  ["wrong speaker", c0, "I have not failed. I've just found 10,000 ways that won't work.", "Albert Einstein", "MISATTRIBUTED"],
  ["not in source", c1, "Insanity is doing the same thing over and over and expecting different results.", "Albert Einstein", "NOT_FOUND"],
];
for (const [label, c, quote, speaker, want] of cases) {
  r = await tx(c, label, "check", [quote, speaker, SRC, ARTICLE]);
  check(r.txExecutionResultName === "FINISHED_WITH_RETURN", `${label} decided`);
  const id = await read("lookup", [quote, speaker, SRC]);
  const k = await read("get_check", [id]);
  console.log(`    #${id} ${k.verdict} verbatim=${k.verbatim} meaning=${k.meaning} attribution=${k.attribution} sha=${k.source_sha256.slice(0, 12)} chars=${k.source_chars}`);
  check(k.verdict === want, `${label}: ${want}`);
  check(k.source_sha256 === SRC_SHA, "source pinned by its sha256");
}
check((await read("get_count")) === start + cases.length, "one check stored per decided call");
check((await read("lookup", ["Never said this at all, anywhere.", "Albert Einstein", SRC])) === -1, "lookup of an unchecked quote is -1");
console.log("contract", address);
