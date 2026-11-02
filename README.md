# QuoteCheck: did they really say that, in the source they cite?

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Articles, posts and slide decks quote people and link a source. Readers
rarely open it, and when they do, the words are often not there, mean
something else once cut, or belong to someone else. **QuoteCheck** is an
Intelligent Contract that settles it in public: anyone submits a quote, who it
is attributed to and the page it cites. GenLayer validators each fetch that
page and must agree on what it shows. The verdict and the page's SHA-256 are
stored on-chain, so a newsroom, a fact-checker or a contract can look it up
instead of taking anyone's word for it.

```
anyone ── check(quote, speaker, source_url, used_in) ── validators each fetch the source
          code: are the exact words there?            (case, quote marks, dashes, spacing ignored)
          validators agree: meaning same | changed | absent; attribution speaker | other | unstated
          code: verdict VERBATIM | PARAPHRASED | DISTORTED | MISATTRIBUTED | UNATTRIBUTED | NOT_FOUND
anyone ── lookup(quote, speaker, source_url) ── id of the latest check, or -1
```

## Live deployment

App: [quotecheck.senju.quest](https://quotecheck.senju.quest) (source in [`app/`](app/): check a quote, look one up, recent checks with what validators agreed and the source hash)  
Testnet Bradbury (chainId 4221): [`0xc1098B8287470C3DBa85737C567c3ef5f2dFC101`](https://scan.testnet-chain.genlayer.com/address/0xc1098B8287470C3DBa85737C567c3ef5f2dFC101)

## Bradbury evidence

Bradbury Phase 2 (GenVM v0.3). Run by [`tests/integration/bradbury.mjs`](tests/integration/bradbury.mjs), every check passed. Contract `0xc1098B8287470C3DBa85737C567c3ef5f2dFC101` (deploy [`0x5c035c5a…`](https://scan.testnet-chain.genlayer.com/tx/0x5c035c5ae39886d17319b63694b52bceb3fe0c763b89e30185708b4369ee116a)), code `build/quote_check.py`. Two accounts sent the checks; validators fetched the source live. The source is [quotes.toscrape.com/page/1/](https://quotes.toscrape.com/page/1/), a public sandbox page that does not change: every stored check pinned its body as sha256 `efdc2605a2062dceb335ba421bd61d3a6795fb88bfa9873096ecd4a9406de1e3` (1,681 characters of text).

| Quote · attributed to | Transaction | Outcome |
|---|---|---|
| source `http://quotes.toscrape.com/page/1/` | [`0x37f18a43…`](https://scan.testnet-chain.genlayer.com/tx/0x37f18a4335a40198350ba8f9bebda601fd913001e4c3b2af1430c941b6930d41) | reverted before any fetch: not https |
| source `https://quotes.toscrape.com/nope` | [`0x9141a709…`](https://scan.testnet-chain.genlayer.com/tx/0x9141a709ea72f35e583d05a356a8bc9711bc6f1c39f6d665f260db4943a0b79c) | reverted: validators agreed `[EXTERNAL] source unavailable (HTTP 404)`; nothing stored. Resent after a leader timeout ([`0xadd17378…`](https://scan.testnet-chain.genlayer.com/tx/0xadd17378e566287c492ee2e9d766b2324128b4e038874ffad3323d74688d4304), NOT_VOTED) |
| “The world as we have created it is a process of our thinking. It cannot be changed without changing our thinking.” · Albert Einstein | [`0x50f874e4…`](https://scan.testnet-chain.genlayer.com/tx/0x50f874e419386130828c16c51bc2f949b94461dab2a23aa2afc0121f5c82e6c4) | #0 **VERBATIM** (word for word, same, speaker) |
| Rather than trying to become a man of success, become a man of value. · Albert Einstein | [`0x4077e377…`](https://scan.testnet-chain.genlayer.com/tx/0x4077e37719e39bf75d24cae67d678d305aba4b5fa41cf5e2b67a902d04f60f6a) | #1 **PARAPHRASED** (same, speaker) |
| Try to become a man of success. · Albert Einstein | [`0x7fc103d9…`](https://scan.testnet-chain.genlayer.com/tx/0x7fc103d9afd2f62aa7ac7d9d28458a12b364b11b431be42cfea681a061c2279e) | #2 **DISTORTED** (changed, speaker): the cut drops “not” |
| I have not failed. I've just found 10,000 ways that won't work. · Albert Einstein | [`0x906d1084…`](https://scan.testnet-chain.genlayer.com/tx/0x906d1084fe28d43723407dcd9e468c0bb04fc0d174254b4a906a081ca956137b) | #3 **MISATTRIBUTED** (word for word, but the page gives it to Thomas A. Edison) |
| Insanity is doing the same thing over and over and expecting different results. · Albert Einstein | [`0x619ae434…`](https://scan.testnet-chain.genlayer.com/tx/0x619ae4343465829434a3d6fd086bce028ac1cd202acc7f6947c50be2f8d66ad6) | #4 **NOT_FOUND** (absent). Resent after a leader timeout ([`0xf808d911…`](https://scan.testnet-chain.genlayer.com/tx/0xf808d91198d805537b326a3e0a23a5635991e965ab538f42efc0d768bebcaf22), NOT_VOTED) |

`lookup` returned each check's id and -1 for a quote never checked. An
earlier deployment of this contract judged a faithful rewording as DISTORTED;
the prompt now defines “changed” as a quote that makes the passage claim
something it does not, and the run above is on the corrected code.

## What it does

| Layer | Mechanism | Depends on the LLM? |
|---|---|---|
| Input | Quote 10–600 chars (outer quote marks trimmed), speaker 2–100 chars, https source URL with a domain name; `used_in` empty or https. Anything else reverts before any fetch | No |
| Word for word | The quote is searched in the page's visible text after NFKC, lowercasing and unifying quote marks, dashes and whitespace | No |
| Meaning and speaker | Each validator asks: does a passage of the page say the same thing, something the quote changes, or nothing like it; and does the page give it to this speaker, someone else, or no one | Yes, by consensus |
| Verdict | Derived in code: absent → NOT_FOUND; other speaker → MISATTRIBUTED; no speaker → UNATTRIBUTED; changed → DISTORTED; else VERBATIM or PARAPHRASED from the word-for-word check | No |
| Record | Every check is kept with the agreed fields, the source's SHA-256 and text length; `lookup` maps (quote, speaker, source) to the latest | No |

## Consensus design

The leader fetches the page, extracts its visible text (scripts and styles
removed, inline tags joined without a space so `cre<i>ated</i>` stays one
word) and checks in code whether the quote appears word for word. That fact is
given to the model, which answers only two closed questions: `meaning` and
`attribution`. A quote found word for word cannot be judged `absent`; if the
model says so the answer is an `[LLM_ERROR]` and a new leader is chosen.

Each validator re-fetches and re-reads the page and accepts only if **every
stored field is identical**: `verbatim`, `meaning`, `attribution`, the SHA-256
of the response body and the text length. The verdict and its fixed reason
text are then derived in contract code, so nothing the model writes is stored.

Errors follow the official classes. A source that cannot be fetched
(`[EXTERNAL] source unavailable (HTTP 404)`) or whose text is over 12,000
characters (`[EXPECTED]`) is agreed on and the transaction reverts: nothing is
stored, and a quote is never judged on part of its source.

Prompt injection: the quote, the speaker and the page are fenced in
`<<< >>>` with delimiter neutralisation; the model only picks from fixed
values.

## Limits

- The verdict is about **the cited page**, not about who really said what in
  history. A quote correctly copied from a page that itself misattributes it
  is VERBATIM for that source. The point is that a reader can see whether a
  citation supports the quote.
- The page is judged as it was at check time. The stored SHA-256 says which
  bytes were read; if the page changes later, rechecking gives a new record and
  `lookup` returns the newest.
- Text behind JavaScript, logins or paywalls is not seen: such a source is
  NOT_FOUND or reverts.
- "Paraphrased" vs "distorted" is a judgment. Validators must agree on it
  exactly; if they cannot, the transaction does not go through, nothing is
  stored, and the quote can be checked again.
- Translation is not handled: a quote and source in different languages will
  usually be PARAPHRASED at best.

## API

| Method | Who | Notes |
|---|---|---|
| `check(quote, speaker, source_url, used_in)` | anyone | returns `{id, verdict, reason}` |
| `get_check(id)`, `get_checks(start)`, `get_count()` | view | up to 50 per page |
| `lookup(quote, speaker, source_url)` | view | latest check id, or -1 |

## Run

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
genvm-lint check contracts/quote_check.py
pytest tests/direct -v                         # 19 tests
node app/check-actions.mjs app/index.html      # the app's Check button follows the contract's input rules
# integration, on Bradbury, against the packed code (keys in GL_PK0..1 env vars, ~25 min)
python deploy/shrink.py contracts/quote_check.py build/quote_check.py --pack
npm i genlayer-js@2.0.0-rc.2   # plus the fee-estimate patch in app/README.md
node tests/integration/bradbury.mjs build/quote_check.py
```

Deploy the output of `deploy/shrink.py` (AST-checked, 4.3 KB packed). CI
re-runs the direct tests against the packed code.

## Tests (19 direct, Bradbury E2E)

- **Input**: every field's limits; plain http and hostless URLs.
- **Verdicts**: verbatim ignoring case, quote marks and spacing; every verdict from the agreed fields; `absent` forces `unstated`; a word-for-word quote judged absent is an LLM error; malformed model answers.
- **Source**: unavailable and oversized pages revert and store nothing; inline tags do not split words, block tags do not join them.
- **Consensus**: a validator rejects any difference in verbatim, meaning, attribution or page hash, and a page that changed; validators agree on the same source error only.
- **Lookup**: latest check wins; unchecked is -1.
