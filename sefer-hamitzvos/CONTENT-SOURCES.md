# Sefer HaMitzvos content review — 2026-10-20

All 248 positive and 365 negative references have an original concise English classroom description in `descriptions.js` and an explicit vocabulary selection in `../word-bank/sefer-vocabulary-catalog.js`. These are explanations of individual mitzvos, not complete practical halachic rulings. Court penalties refer only to a properly authorized Torah court and its required procedures.

## Primary sources reviewed

- Rambam, Sefer HaMitzvot, Hebrew: https://www.sefaria.org/Sefer_HaMitzvot ; full positive and negative sections retrieved through the Sefaria text API, Hebrew version `Sefer Hamitzvot, Warsaw 1883` (edition metadata supplied by the API).
- Rambam's enumerated mitzvah summaries, Mishneh Torah introduction: https://www.sefaria.org/Mishneh_Torah,_Positive_Mitzvot and https://www.sefaria.org/Mishneh_Torah,_Negative_Mitzvot . Hebrew text used to cross-check each subject and its central terms, not to reassign Sefer HaMitzvos numbering.
- Chabad's Sefer HaMitzvot Digest indexes, the established app numbering: https://www.chabad.org/library/article_cdo/aid/900181/jewish/Positive-Commandments.htm and https://www.chabad.org/library/article_cdo/aid/900433/jewish/Negative-Commandments.htm .
- Explicit edition check: https://www.chabad.org/library/article_cdo/aid/900731/jewish/Negative-Commandment-295.htm and https://www.chabad.org/library/article_cdo/aid/900732/jewish/Negative-Commandment-296.htm . The app continues to use N295 for ransom for an intentional murderer and N296 for ransom replacing exile. Some Hebrew editions reverse these two numbers. P17/P18 and N167/N168/N327–329 likewise follow the existing Sefer HaMitzvos reference table, not a differently ordered Mishneh Torah list.

## Review decisions

- Every reference has an explicit action or prohibition, replacing reliance on ambiguous subject-only picture captions. The authoritative classroom description is displayed immediately above the picture. Existing picture files remain intact; their shorter captions are illustrations rather than the full explanation.
- All 613 vocabulary sets are explicit per reference. No regex, substring, or generic fallback chooses lesson words. Each set has one to three central terms. Existing vocalized spellings are retained where the reviewed term is unchanged. No existing collected words or student records are migrated or deleted.
- Distinguish P247 (rescue from an attacker) from N297 (do not stand by in mortal danger); N265 (pressuring acquisition of another's possession) from N266 (desiring it); P236 (monetary liability for injury) from unrelated family vocabulary; N31–38 (different prohibited practices) from a generic sorcery label.
- City-of-refuge lessons P182, P225 and N296 include the city-of-refuge term; ransom lessons include כופר.
- Numbering, card order, calendar, navigation floor, future-date restrictions and account access are unchanged.
