# Large pictures for Halacha Simanim Beis and Gimmel (brief for ChatGPT / an artist)

The small pictures now in the lessons (146 or 184 pixels wide, cut off on the right) are placeholders.
Siman Aleph has large coloring pictures. These 17 pictures need to look like those.

## How each file must look
- Black-and-white **line art** for coloring, white inside every shape. No gray, no shading, no color.
- **Size 1000 x 750 pixels, PNG**, landscape (like Siman Aleph).
- Thick, clean outlines. **Every shape fully closed** (no gaps), so one tap fills exactly one shape.
- Same style as Siman Aleph: friendly cartoon boys about 8-9 years old in a kippah, white shirt, tzitzis
  **clearly visible** (fringes hanging at the four corners of the tallis katan, showing at the belt).
- Chabad-appropriate and modest: long sleeves, no depiction of Hashem. Show light or sunrise, never a figure.
- Two side-by-side panels (like Aleph seif 1) is welcome when it tells the story: "what to do / what not to do".
- No words inside the picture (the lesson shows the Hebrew).

## File names (put them in `halacha/art/simanim/`)
`siman-2-seif-01.png` ... `siman-2-seif-09.png` and `siman-3-seif-01.png` ... `siman-3-seif-08.png`

## What each picture shows
**Siman Beis (2)**
1. Boy waking up in bed, stretching, sunrise at the window; a washing cup and bowl by the bed.
2. Boy pulling a tallis katan over his head; tzitzis visible at the corners.
3. Boy pouring water from a cup over his right hand, then his left hand, into a basin; second panel: washing his face.
4. Boy washing his hands into a bowl (not onto the floor); a second panel pouring the water out in a quiet corner of the yard.
5. Boy sitting up with his hands held down in front of him, not touching his eyes, nose, ears or mouth (small icons of those four around him).
6. Boy at a stream scooping water onto his hands; second panel: boy at home with the proper cup.
7. Boy at a sink washing hands a second time, then holding a siddur ready to say the bracha.
8. Boy dozing on a couch in the afternoon; thought bubble showing a cup and three pours (no bracha).
9. Four small scenes in one picture: boy cutting nails, taking off shoes, leaving the bathroom, washing hands.

**Siman Gimmel (3)**
1. Boy changing clothes modestly under his blanket; light from the window (Hashem is everywhere).
2. Boy choosing simple Jewish clothes from a closet (crossed-out flashy costume on a hanger).
3. Three boys: too fancy, too torn, and the middle one in neat clean clothes (the right one).
4. Boy putting his right shoe on first, then the left; second panel: untying the left shoe first.
5. Boy pulling on two shirts at once, looking confused and holding one up (be careful, easy to forget).
6. Boy with kippah on his head walking to shul; mother or father pointing at his kippah.
7. Boy walking in a calm, moderate way: not stiff and not bent over, looking where he steps.
8. Boy walking carefully along a sidewalk, with space on both sides (a dog on one side only, far away).

## When the files are ready
Put the PNGs in this folder and tell Claude. Claude lists each file name in `LARGE_ART` in
`halacha/fresh-simanim-2-3.js`, runs the browser tests, and the new picture replaces the small one.
Coloring already done on the small pictures is kept separately and is not lost.
