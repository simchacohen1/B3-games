/* Yiddish Story 2 — the text, audio and pictures for the second story.
   Fill this in when the text and audio arrive. See README.md in this folder.
   While `paras` is empty, students do not see Story 2 at all. */
window.YIDDISH_STORY_2 = {
  /* English title shown in the header and on the Yiddish page. */
  title: 'Story 2',
  /* Optional Yiddish title, shown right-to-left under the English title. */
  titleYi: '',
  /* Who tells or published the story (shown small in the header). Use \n for a new line. */
  credit: 'Yiddish story',
  /* One short English sentence for the Story Corner card. */
  blurb: 'A new story to read and listen to.',
  /* Audio file in this folder. Add ?v=2 etc. after replacing the file so browsers fetch the new one. */
  audio: 'audio.mp3',
  /* Optional English lines shown above the story (like the Wine Merchant's English intro). */
  intro: [],
  /* The Yiddish story, one paragraph per string, in order. Keep the original wording. */
  paras: [],
  /* Optional: the second in audio.mp3 where each paragraph starts, by paragraph number (0 = first).
     Example: {"0": 1.2, "1": 20.8}. Without this, clicking a paragraph does not move the audio. */
  times: {},
  /* Optional pictures (files in a pictures/ folder here). `para` = the paragraph the picture goes with.
     Example: {src: 'pictures/01.jpg', para: 0, caption: 'The town'} */
  pictures: []
};
