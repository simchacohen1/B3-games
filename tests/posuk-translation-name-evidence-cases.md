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
