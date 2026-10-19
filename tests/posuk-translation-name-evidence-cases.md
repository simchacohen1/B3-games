# Posuk Practice translation grading — name evidence test cases

These are manual grading cases for the **spoken** translation function. Use an identical Hebrew chunk and expected translation for each pair; vary only the recognized speech and alternatives. They are acceptance criteria, not recorded passing test results.

| Case | Correct answer includes | Student transcript / recognition | Expected |
| --- | --- | --- | --- |
| Same name, normal variant | Avraham | "Avrohom" | correct |
| Genuine STT error supported by audio alternative | Sodom | "Saddam" with phonetic alternative "Sodom" | correct |
| Different person's name | Avraham | "Yitzchok" with no Avraham-like alternative | incorrect |
| Missing name | Avraham | Student says only the action, omits subject | incorrect |
| Unrelated word occupying name slot | Lot | "the man" without phonetic alternative | incorrect |
| Answer-key contamination | Mamre | recognizer transcript unrelated to Mamre; name vocabulary hint includes Mamre | incorrect |
| Wrong tense | "he went" | "he will go" | incorrect |
| Wrong referent | "to him" | "to Avrohom" | incorrect |
| Legitimate synonym | "said" | "told" where context permits | correct |

**Review note:** The grading prompt has other rules to audit before deployment, including permissive acceptance of semantically different full-posuk translations. Run audio-based regression tests across multiple pesukim and retain teacher-review handling for ambiguous recordings. Do not merge from these written scenarios alone.

## Independent-reference and grammar regressions

| Case | Accepted meaning | Spoken translation | Expected |
| --- | --- | --- | --- |
| Equivalent synonym | "he told him" | "he said to him" | correct |
| Pronoun substituted with story knowledge | "he said to him" | "he said to Avrohom" | incorrect |
| Changed agent | "she spoke to him" | "he spoke to her" | incorrect |
| Missing negation | "he did not go" | "he went" | incorrect |
| Different tense | "they will return" | "they returned" | incorrect |
| Number changed | "the angels came" | "the angel came" | incorrect |
| Missing necessary word | "he went to the city" | "he went" | incorrect |
| Valid independent source | Source A says "pleasure"; source B renders the same chunk "smooth skin" | "smooth skin" | correct when B truly corresponds to same chunk |
| Unrelated source detail | Source B's whole-posuk description mentions bread outside the target chunk | "he baked bread" | incorrect for another chunk |
| Mixed partial sources | Student combines unrelated half-phrases from A and B, matching no complete interpretation | mixed partial answer | incorrect |
| Name hint mistaken as audio | name hint contains Yitzchok, but speech is "he went" without a name | "he went" | incorrect if name required |

These are specifications for later recordings-based evaluation. Check live saved-response compatibility, speech recognition alternatives, and correct/incorrect response schema before deployment.
