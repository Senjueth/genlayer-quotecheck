"""QuoteCheck: verdicts derived from what validators agree the cited page shows."""

import hashlib

import pytest

from tests.direct.conftest import EINSTEIN, PAGE, URL, reading, to_hex

SHA = hashlib.sha256(PAGE.encode()).hexdigest()


@pytest.mark.parametrize(
    "args,err",
    [
        (("short", "Albert Einstein", URL, ""), "quote must be"),
        (("x" * 601, "Albert Einstein", URL, ""), "quote must be"),
        ((EINSTEIN, "A", URL, ""), "speaker must be"),
        ((EINSTEIN, "Albert Einstein", "http://quotes.toscrape.com/", ""), "https URL"),
        ((EINSTEIN, "Albert Einstein", "https://localhost/x", ""), "https URL"),
        ((EINSTEIN, "Albert Einstein", URL, "not a url"), "used_in"),
    ],
)
def test_input_is_validated(args, err, qc, direct_vm):
    with direct_vm.expect_revert(err):
        qc.check(*args)
    assert qc.get_count() == 0


def test_verbatim_quote_ignores_case_quote_marks_and_spacing(qc, direct_vm, direct_alice):
    out = qc.check(f'"{EINSTEIN.upper()}"', " Albert   Einstein ", URL, "https://example.com/article")
    assert out["verdict"] == "VERBATIM" and out["id"] == 0
    c = qc.get_check(0)
    assert c["verbatim"] and c["meaning"] == "same" and c["attribution"] == "speaker"
    assert c["source_sha256"] == SHA and c["source_chars"] == len(PAGE)
    assert c["quote"] == EINSTEIN.upper() and c["speaker"] == "Albert Einstein"
    assert c["requester"].lower() == to_hex(direct_alice).lower()
    assert qc.lookup(EINSTEIN, "albert einstein", URL) == 0
    assert qc.lookup(EINSTEIN, "Thomas Edison", URL) == -1


@pytest.mark.parametrize(
    "meaning,attribution,verdict",
    [
        ("same", "speaker", "PARAPHRASED"),
        ("changed", "speaker", "DISTORTED"),
        ("same", "other", "MISATTRIBUTED"),
        ("changed", "unstated", "UNATTRIBUTED"),
        ("absent", "speaker", "NOT_FOUND"),  # attribution is forced to unstated
    ],
)
def test_verdict_follows_from_agreed_fields(meaning, attribution, verdict, qc, direct_vm):
    reading(direct_vm, meaning, attribution)
    out = qc.check("The world cannot change unless we change how we think.", "Albert Einstein", URL, "")
    assert out["verdict"] == verdict
    c = qc.get_check(0)
    assert not c["verbatim"]
    if meaning == "absent":
        assert c["attribution"] == "unstated"


def test_later_check_replaces_the_lookup(qc, direct_vm):
    qc.check(EINSTEIN, "Albert Einstein", URL, "")
    reading(direct_vm, "same", "other")
    qc.check(EINSTEIN, "Albert Einstein", URL, "")
    assert qc.lookup(EINSTEIN, "Albert Einstein", URL) == 1
    assert [c["verdict"] for c in qc.get_checks(0)] == ["VERBATIM", "MISATTRIBUTED"]


def test_verbatim_judged_absent_is_an_llm_error(qc, direct_vm):
    reading(direct_vm, "absent", "unstated")
    with direct_vm.expect_revert("judged absent"):
        qc.check(EINSTEIN, "Albert Einstein", URL, "")


def test_bad_model_output_reverts(qc, direct_vm):
    reading(direct_vm, "maybe", "speaker")
    with direct_vm.expect_revert("LLM_ERROR"):
        qc.check(EINSTEIN, "Albert Einstein", URL, "")


def test_unavailable_or_oversized_source_reverts(qc, direct_vm):
    reading(direct_vm, status=404)
    with direct_vm.expect_revert("source unavailable (HTTP 404)"):
        qc.check(EINSTEIN, "Albert Einstein", URL, "")
    reading(direct_vm, page=PAGE + " word" * 3000)
    with direct_vm.expect_revert("over 12000 characters"):
        qc.check(EINSTEIN, "Albert Einstein", URL, "")
    assert qc.get_count() == 0


def test_text_extraction_keeps_words_whole(qc, direct_vm):
    page = "<p>“The world as <b>we</b> have cre<i>ated</i> it&nbsp;is a process of our thinking.</p><script>x()</script>"
    reading(direct_vm, page=page)
    assert qc.check("The world as we have created it is a process of our thinking.", "Albert Einstein", URL, "")["verdict"] == "VERBATIM"
    reading(direct_vm, page="<p>The world as we</p><p>have created it is a process of our thinking.</p>")
    # Block tags end a word but keep the space, so the quote still runs across them.
    assert qc.get_check(qc.check("The world as we have created it is a process of our thinking.", "Albert Einstein", URL, "")["id"])["verbatim"]


# ── Consensus ───────────────────────────────────────────────────────────────


def test_validator_agrees_only_on_identical_fields(qc, direct_vm):
    qc.check(EINSTEIN, "Albert Einstein", URL, "")
    mine = {"verbatim": True, "meaning": "same", "attribution": "speaker", "sha256": SHA, "chars": len(PAGE)}
    assert direct_vm.run_validator(leader_result=mine) is True
    assert direct_vm.run_validator(leader_result={**mine, "attribution": "other"}) is False
    assert direct_vm.run_validator(leader_result={**mine, "meaning": "changed"}) is False
    assert direct_vm.run_validator(leader_result={**mine, "sha256": "0" * 64}) is False
    assert direct_vm.run_validator(leader_result={**mine, "verbatim": 1}) is False
    # A validator whose page differs disagrees.
    reading(direct_vm, page=PAGE + " (updated)")
    assert direct_vm.run_validator(leader_result=mine) is False


def test_validators_agree_on_the_same_source_error_only(qc, direct_vm):
    qc.check(EINSTEIN, "Albert Einstein", URL, "")
    reading(direct_vm, status=404)
    assert direct_vm.run_validator(leader_error="[EXTERNAL] source unavailable (HTTP 404)") is True
    assert direct_vm.run_validator(leader_error="[EXTERNAL] source unavailable (HTTP 500)") is False
    reading(direct_vm)
    assert direct_vm.run_validator(leader_error="[EXTERNAL] source unavailable (HTTP 404)") is False
