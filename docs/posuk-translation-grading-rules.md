# Posuk Translation Grading Rules

This guide defines how the translation grader should judge one student's text answer for one Hebrew chunk. It applies whether the text came from typing or speech recognition. The grader does not receive audio; it receives the recognized transcript and, when available, ranked text alternatives from the same recording.

## 1. Scope and evidence

1. **Grade only the displayed Hebrew chunk.** Do not grade the whole verse, surrounding story, lesson, or what the student probably meant to say.
2. **Treat the Hebrew chunk as the scope of the answer.** Identify the words and semantic units expressed in that chunk before comparing English.
3. **Use the supplied translations as answer evidence.** The generated accepted translations, Torah Umesorah reference, and Kehot reference are independent accepted sources when supplied.
4. **One source is enough.** If the answer faithfully matches any one source's meaning for this chunk, mark it correct even if another source uses different wording or a different valid interpretation.
5. **Map whole-verse translations to this chunk.** Use only the corresponding portion. Do not accept words from an adjacent phrase, another verse, or unrelated commentary.
6. **Never combine fragments from different sources into a new answer key.** A single source must support the student's meaning for the target chunk.
7. **Do not substitute story knowledge for translation.** Names and pronouns must be supported by the Hebrew and answer evidence, not by knowing who is in the story.

## 2. What makes an answer correct

8. **Preserve the essential meaning.** Check the actor, action, object, recipient, reference, tense, number, negation, possession, and important relationships expressed by the Hebrew.
9. **Preserve who did what to whom.** Reversing the speaker and listener, actor and object, or another grammatical relationship changes the answer.
10. **Do not omit an essential unit.** A fragment such as “the staff” does not translate a chunk that says “he took the staff.”
11. **Do not add a conflicting unit.** A correct noun with the wrong action, tense, person, number, or negation is not a correct translation.
12. **Do not award correctness for vague thematic similarity.** An answer that sounds related to the story but does not translate the words is incorrect.
13. **Respect meaningful grammatical distinctions.** Preserve tense, number, person, negation, and pronoun reference when they change the meaning. Allow grammatical changes only when they preserve the same meaning and are supported by a valid source.
14. **Allow natural English.** Do not require Hebrew word order, exact phrasing, or a leading “and” that only connects the chunk to preceding text.
15. **Accept faithful synonyms and paraphrases.** For example, “he told him” or “he spoke to him” can translate “he said to him” when the actor, recipient, and time remain the same.
16. **Allow harmless sentence restructuring.** A student may split a phrase into two short statements or use a natural question/statement form when the source wording supports the same meaning.
17. **Do not penalize equally valid source wording.** For עֶדְנָה, for example, “pleasure/enjoyment,” “freshness,” and “my skin will become smooth” must each be accepted when that wording is supported by its supplied source.

## 3. Names and place names

18. **Accept ordinary spellings and pronunciations of the same name.** Include classroom Ashkenazi forms such as Avrohom, Yitzchok, Sorah, and Hashem.
19. **Require positive evidence for a name correction.** A name hint or the expected answer alone does not prove the student said that name.
20. **Use same-recording alternatives as recognition evidence.** If the first transcript says “a ram said” and another alternative from that same segment says “Avrohom said,” the alternative supports the local name correction; accept it when the surrounding words agree.
21. **Keep a recognition repair local.** A name alternative may resolve the name only. It cannot repair a wrong verb, tense, pronoun, number, or omitted meaning.
22. **Do not replace a clearly different name.** A coherent, unrelated name or a missing name remains wrong unless the transcript or a same-recording alternative provides plausible phonetic evidence for the intended name.
23. **Accept a place name or its faithful literal rendering.** “Mamre” and “the oaks/terebinths of Mamre” can both be correct when they refer to the same Hebrew phrase.
24. **Accept “Hashem” for a name of God.** This is the student's classroom convention and is fully equivalent for grading.

## 4. Speech-recognition text

25. **Grade the recognized words, not imagined audio.** Do not infer a word that is absent from both the transcript and its recognition alternatives.
26. **Treat the first transcript as the default.** Consider a lower-ranked alternative only when it provides specific evidence of a local recognition error, especially a proper-name homophone, while the rest of the segment stays aligned.
27. **Do not use an alternative merely because it matches the answer key.** It must be plausible evidence from the same recording.
28. **If the transcript is unclear, do not invent a repair.** Use the available transcript and alternatives under the same meaning rules. The current product contract returns only “correct” or “incorrect”; it has no separate “unclear/retry” grade.

## 5. Verdict and feedback

29. **Use the two-tier contract.** Mark “correct” only when the full essential meaning matches at least one valid source or a faithful equivalent. Otherwise mark “incorrect”; there is no partial-credit verdict.
30. **Keep feedback tied to this chunk.** When incorrect, explain what this Hebrew chunk means. Do not affirm an answer from an adjacent phrase in the same verse.
31. **Keep feedback short, kind, and age-appropriate.** Use one simple sentence for an 8-year-old.
32. **For a correct answer, praise without adding a correction.** Do not follow praise with “but,” a caveat, or another lesson.
33. **For an incorrect answer, gently guide the student.** State the relevant meaning simply so the student can try again; do not merely repeat the accepted answer word for word.
34. **Use Ashkenazi phonetic spelling in spoken feedback.** The feedback is read aloud, so use forms such as Avrohom, Yitzchok, Sorah, and Hashem.
35. **Return only valid JSON.** The response must contain exactly the verdict (“correct” or “incorrect”) and one feedback sentence, with no preamble or markdown.

## Known limitation

These rules guide the grader; they do not prove it follows them consistently across the entire Chumash. Validation must separately check that each source answer is accurate for its Hebrew chunk, that the grader accepts source-faithful answers, and that it handles paraphrases and errors correctly. A finite test set cannot cover every possible student wording.
