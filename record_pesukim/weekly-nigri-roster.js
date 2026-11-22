/* Fixed East Track / West Track rosters for the weekly practice marks sent to Nigri.
   Same boys and Nigri names as weekly-quiz/nigri-sync.js. Kept in its own file so the staging
   package can replace it with an empty stub (staging must not contain the real roster). */
window.WEEKLY_NIGRI_ROSTER = {
  rosters: {
    et: ['chaim_chaikin', 'yossi_gourarie', 'sholom_huebner', 'moshe_lapine', 'kehos_notik', 'yisroel_oirechman', 'berel_raichik', 'moshe_raichman', 'avrohom_rosenfeld', 'levi_rozmarin', 'arik_traxler'],
    wt: ['ari_greenberg', 'zev_rosenfeld', 'levi_schtroks', 'yisroel_aryeh_simmonds', 'leibel_vogel', 'leib_wolf']
  },
  names: {
    chaim_chaikin: 'Chaikin Mayer Chaim', yossi_gourarie: 'Gourarie Yossi', sholom_huebner: 'Huebner Sholom DovBer',
    moshe_lapine: 'Lapine Moshe', kehos_notik: 'Notik Kehos', yisroel_oirechman: 'Oirechman Yisroel', berel_raichik: 'Raichik Berel',
    moshe_raichman: 'Raichman Moshe Tuvia', avrohom_rosenfeld: 'Rosenfeld Avrohom', levi_rozmarin: 'Rozmarin Levi',
    arik_traxler: 'Traxler Arik', ari_greenberg: 'Greenberg Ari', zev_rosenfeld: 'Rosenfeld Zev',
    levi_schtroks: 'Schtroks Levi', yisroel_aryeh_simmonds: 'Simmonds Yisroel Aryeh', leibel_vogel: 'Vogel Leibel',
    leib_wolf: 'Wolf Yisroel Arye Leib'
  },
  classSections: { et: 'B3 ET', wt: 'B3 WT' }
};
