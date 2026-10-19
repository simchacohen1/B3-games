/* Sefer HaMitzvos direct-reference vocabulary.
 * IMPORTANT: Every displayed Hebrew term must be directly anchored to the
 * numbered mitzvah's verified title/subject. Never pad with broad topic words.
 * A title with no approved word has an empty matching activity, not guesses.
 * To add vocabulary, add an explicit title-anchored match or a reviewed
 * numbered-ref override. This is a safety constraint, not a target count.
 */
(function(root){
 'use strict';
 const rules=[[/city of refuge/i,"עִיר מִקְלָט","city of refuge"],
  [/exil|banish/i,"גָּלוּת","exile"],
  [/inadvertent|unintentional|accidental/i,"שׁוֹגֵג","unintentional"],
  [/murder|killer/i,"רוֹצֵחַ","killer"],
  [/covet|plotting to acquire/i,"לֹא תַחְמֹד","do not covet"],
  [/desir(e|ing) another|desire.*belong/i,"לֹא תִתְאַוֶּה","do not desire another's possession"],
  [/property|possessions|owner|thief|steal|robbery/i,"רְכוּשׁ","property"],
  [/idol|idolat|false god|foreign theolog|worship.*other/i,"עֲבוֹדָה זָרָה","idol worship"],
  [/false prophet|prophec/i,"נְבִיא שֶׁקֶר","false prophet"],
  [/prophet/i,"נָבִיא","prophet"],
  [/sorc(er|ery)|witchcraft|divination|omen|astrolog|incantation|soothsaying|magic/i,"כִּשּׁוּף","sorcery"],
  [/inciter|inciting/i,"מֵסִית","inciter"],
  [/temple|sanctuary|beis hamikdash/i,"בֵּית הַמִּקְדָּשׁ","Beis Hamikdash"],
  [/\bark\b/i,"אֲרוֹן הַבְּרִית","holy ark"],
  [/menorah/i,"מְנוֹרָה","menorah"],
  [/altar/i,"מִזְבֵּחַ","altar"],
  [/incense/i,"קְטֹרֶת","incense"],
  [/showbread/i,"לֶחֶם הַפָּנִים","showbread"],
  [/anoint/i,"שֶׁמֶן הַמִּשְׁחָה","anointing oil"],
  [/bless(ing|ings)|grace after meals/i,"בְּרָכָה","blessing"],
  [/prayer|pray/i,"תְּפִלָּה","prayer"],
  [/shema\b/i,"שְׁמַע יִשְׂרָאֵל","Shema"],
  [/tefillin|phylacter/i,"תְּפִלִּין","tefillin"],
  [/mezuzah/i,"מְזוּזָה","mezuzah"],
  [/tzitzit|fringes/i,"צִיצִית","tzitzis"],
  [/shofar/i,"שׁוֹפָר","shofar"],
  [/trumpet/i,"חֲצוֹצְרוֹת","trumpets"],
  [/torah|scripture/i,"תּוֹרָה","Torah"],
  [/scroll|book/i,"סֵפֶר","scroll/book"],
  [/stud(y|ying)|teach(ing)?|learning/i,"לִמּוּד","learning"],
  [/shabbat|sabbath/i,"שַׁבָּת","Shabbos"],
  [/work|labor/i,"מְלָאכָה","work"],
  [/\brest(ing)?\b/i,"מְנוּחָה","rest"],
  [/kiddush/i,"קִדּוּשׁ","Kiddush"],
  [/havdalah/i,"הַבְדָּלָה","Havdalah"],
  [/passover|pesach|paschal/i,"פֶּסַח","Pesach"],
  [/matza(h)?/i,"מַצָּה","matzah"],
  [/chametz|leaven/i,"חָמֵץ","chametz"],
  [/sukkah|sukkot/i,"סֻכָּה","sukkah"],
  [/shavuot/i,"שָׁבוּעוֹת","Shavuos"],
  [/rosh hashanah/i,"רֹאשׁ הַשָּׁנָה","Rosh Hashanah"],
  [/yom kippur/i,"יוֹם כִּפּוּר","Yom Kippur"],
  [/shemini atzeret/i,"שְׁמִינִי עֲצֶרֶת","Shemini Atzeres"],
  [/festival|holiday/i,"יוֹם טוֹב","Yom Tov"],
  [/omer/i,"עֹמֶר","Omer"],
  [/count(ing)?/i,"סְפִירָה","counting"],
  [/month|new moon|rosh chodesh/i,"חֹדֶשׁ","month"],
  [/year/i,"שָׁנָה","year"],
  [/fast(ing)?/i,"צוֹם","fast"],
  [/rejoic(ing|e)|joy/i,"שִׂמְחָה","joy"],
  [/offering|sacrifice|sacrificial/i,"קָרְבָּן","offering"],
  [/sin offering/i,"קָרְבַּן חַטָּאת","sin offering"],
  [/guilt offering/i,"קָרְבַּן אָשָׁם","guilt offering"],
  [/burnt offering/i,"קָרְבַּן עוֹלָה","burnt offering"],
  [/meal offering/i,"מִנְחָה","meal offering"],
  [/priest|kohen|high priest/i,"כֹּהֵן","Kohen"],
  [/high priest/i,"כֹּהֵן גָּדוֹל","Kohen Gadol"],
  [/levite/i,"לֵוִי","Levi"],
  [/priestly garment|priest.s robe|breastplate|apron/i,"בִּגְדֵי כְּהֻנָּה","priestly garments"],
  [/purif|ritual purity/i,"טָהֳרָה","ritual purity"],
  [/impur|unclean|defil/i,"טֻמְאָה","ritual impurity"],
  [/mikvah|immersi|ritual pool/i,"מִקְוֶה","mikvah"],
  [/tzaraat|metzora|leper/i,"צָרַעַת","tzaraas"],
  [/red heifer/i,"פָּרָה אֲדֻמָּה","red heifer"],
  [/corpse|dead|bury|burial|funeral/i,"מֵת","deceased person"],
  [/vow|pledge/i,"נֶדֶר","vow"],
  [/oath|swear|swearing/i,"שְׁבוּעָה","oath"],
  [/confess(ing|ion)?/i,"וִדּוּי","confession"],
  [/repent|teshuva/i,"תְּשׁוּבָה","repentance"],
  [/\bsins?\b/i,"חֵטְא","sin"],
  [/theft|steal|thief/i,"גְּנֵבָה","theft"],
  [/return(ing)? .*lost|lost (article|item|object)/i,"הֲשָׁבַת אֲבֵדָה","returning lost property"],
  [/restitution/i,"תַּשְׁלוּמִין","compensation"],
  [/damage|injury|goring|attacker/i,"נֶזֶק","damage"],
  [/fire|arson/i,"אֵשׁ","fire"],
  [/grazing animal|herd/i,"בְּהֵמָה","domestic animal"],
  [/ox|bull/i,"שׁוֹר","ox"],
  [/animal|beast|cattle/i,"בְּהֵמָה","animal"],
  [/bird|fowl/i,"עוֹף","bird"],
  [/fish/i,"דָּג","fish"],
  [/insect|locust|grasshopper/i,"חָגָב","locust"],
  [/blood/i,"דָּם","blood"],
  [/meat|flesh/i,"בָּשָׂר","meat"],
  [/slaughter/i,"שְׁחִיטָה","shechitah"],
  [/kosher/i,"כָּשֵׁר","kosher"],
  [/fat(s)?\b/i,"חֵלֶב","fat"],
  [/cooking|boil/i,"בִּשּׁוּל","cooking"],
  [/eating|consum(ing|ption)|food/i,"אֲכִילָה","eating"],
  [/firstborn/i,"בְּכוֹר","firstborn"],
  [/redeem|redemption/i,"פִּדְיוֹן","redemption"],
  [/dough|challah/i,"חַלָּה","challah"],
  [/tithe/i,"מַעֲשֵׂר","tithe"],
  [/terumah|priestly portion/i,"תְּרוּמָה","terumah"],
  [/first fruit/i,"בִּכּוּרִים","first fruits"],
  [/field|crop|harvest|grain|wheat/i,"שָׂדֶה","field"],
  [/vineyard|grape/i,"כֶּרֶם","vineyard"],
  [/fruit|tree/i,"פְּרִי","fruit"],
  [/sheave/i,"עֹמֶר","sheaf"],
  [/forgotten sheaves/i,"שִׁכְחָה","forgotten sheaves"],
  [/fallen stalk/i,"לֶקֶט","fallen stalks"],
  [/field.s (corner|edge)|edges of the fields/i,"פֵּאָה","field corner"],
  [/sabbatical|shemitta|shemitah/i,"שְׁמִטָּה","Shemitah"],
  [/jubilee/i,"יוֹבֵל","Yovel"],
  [/land of israel|eretz yisrael/i,"אֶרֶץ יִשְׂרָאֵל","Eretz Yisrael"],
  [/jerusalem/i,"יְרוּשָׁלַיִם","Yerushalayim"],
  [/inheritance|hereditary/i,"נַחֲלָה","inheritance"],
  [/\bcit(?:y|ies)\b|walled cit/i,"עִיר","city"],
  [/home|house|houses|dwelling/i,"בַּיִת","house"],
  [/boundary|border/i,"גְּבוּל","boundary"],
  [/judge|judgment|judicial|court|trial/i,"בֵּית דִּין","court"],
  [/witness|testimony|evidence/i,"עֵד","witness"],
  [/verdict|decision/i,"פְּסַק דִּין","ruling"],
  [/execution|punish|death penalty|capital offense/i,"עֹנֶשׁ","punishment"],
  [/flogg(ing)?/i,"מַלְקוֹת","lashes"],
  [/bribe/i,"שֹׁחַד","bribe"],
  [/ransom/i,"כֹּפֶר","ransom"],
  [/fine\b/i,"קְנָס","fine"],
  [/loan|lend|borrower|lending/i,"הַלְוָאָה","loan"],
  [/interest/i,"רִבִּית","interest"],
  [/debt/i,"חוֹב","debt"],
  [/poor|charity|tzedakah/i,"צְדָקָה","tzedakah"],
  [/measure|weight|scale/i,"מִדָּה","measure"],
  [/business|transaction|buy|sell|selling|sale/i,"מִקָּח וּמִמְכָּר","buying and selling"],
  [/lost|deposit|watchman|guard(ian|ing)?|custody/i,"שְׁמִירָה","guarding"],
  [/servant|slave|bondsman|maidservant/i,"עֶבֶד","servant"],
  [/wage|employee|worker|laborer/i,"שָׂכָר","wages"],
  [/\bking\b|\bmonarch\b/i,"מֶלֶךְ","king"],
  [/army|battle|\bwar\b|siege/i,"מִלְחָמָה","war"],
  [/amalek/i,"עֲמָלֵק","Amalek"],
  [/egypt/i,"מִצְרַיִם","Egypt"],
  [/canaanite|seven nations/i,"שֶׁבַע עֲמָמִים","seven nations"],
  [/marry|married|marriage|husband|wife|widow/i,"נִשּׂוּאִין","marriage"],
  [/divorce/i,"גֵּט","get (divorce document)"],
  [/circumcision/i,"בְּרִית מִילָה","bris milah"],
  [/brother|sister|father|mother|parent|daughter|\bson\b/i,"מִשְׁפָּחָה","family"],
  [/levirate|yibbum/i,"יִבּוּם","yibbum"],
  [/beautiful captive/i,"יְפַת תֹּאַר","beautiful captive"],
  [/sotah|suspected adulteress/i,"סוֹטָה","sotah"],
  [/kindness/i,"חֶסֶד","kindness"],
  [/love|loving/i,"אַהֲבָה","love"],
  [/hatred|hate/i,"שִׂנְאָה","hatred"],
  [/revenge|vengeance/i,"נְקָמָה","revenge"],
  [/grudge/i,"נְטִירָה","holding a grudge"],
  [/respect|honor|honoring/i,"כָּבוֹד","honor"],
  [/reprov|rebuk/i,"תּוֹכֵחָה","rebuke"],
  [/slander|gossip/i,"לָשׁוֹן הָרָע","slander"],
  [/curse|cursing/i,"קְלָלָה","curse"],
  [/truth|false testimony|deceit|dishonest/i,"שֶׁקֶר","falsehood"],
  [/hol(y|iness)|sanctif|sacred/i,"קֹדֶשׁ","holiness"],
  [/g-d|hashem|divine/i,"הַשֵּׁם","Hashem"],
  [/belief|believ/i,"אֱמוּנָה","faith"],
  [/\bunity\b|one g-d/i,"אֶחָד","one"],
  [/fear|reverence/i,"יִרְאָה","fear/reverence"],
  [/nazirite/i,"נָזִיר","nazir"],
  [/hair|shav(e|ing)|sideburn/i,"שֵׂעָר","hair"],
  [/cloth|garment|clothes|robe|wearing/i,"בֶּגֶד","garment"],
  [/wool/i,"צֶמֶר","wool"],
  [/linen/i,"פִּשְׁתִּים","linen"],
  [/tattoo/i,"כְּתוֹבֶת קַעֲקַע","tattoo"],
  [/\boil\b/i,"שֶׁמֶן","oil"],
  [/salt/i,"מֶלַח","salt"],
  [/honey/i,"דְּבַשׁ","honey"],
  [/wine|inebriat|drunk/i,"יַיִן","wine"],
  [/bread/i,"לֶחֶם","bread"],
  [/water/i,"מַיִם","water"],
  [/circumvent|avoid|neglect/i,"בִּטּוּל","neglect"]];
 const overrides={
  "P225": [
    [
      "עִיר מִקְלָט",
      "city of refuge"
    ],
    [
      "גָּלוּת",
      "exile"
    ],
    [
      "בֵּית דִּין",
      "Jewish court"
    ]
  ],
  "N265": [
    [
      "לֹא תַחְמֹד",
      "do not covet"
    ],
    [
      "חֶמְדָּה",
      "coveting"
    ],
    [
      "רְכוּשׁ הַזּוּלָת",
      "another person's possessions"
    ]
  ],
  "N266": [
    [
      "לֹא תִתְאַוֶּה",
      "do not desire another's possessions"
    ],
    [
      "תַּאֲוָה",
      "desire"
    ],
    [
      "רְכוּשׁ הַזּוּלָת",
      "another person's possessions"
    ]
  ],
  "N4": [
    [
      "פֶּסֶל",
      "statue"
    ]
  ],
  "N7": [
    [
      "מֹלֶךְ",
      "Molech"
    ]
  ],
  "N8": [
    [
      "אוֹב",
      "Ov"
    ]
  ],
  "N9": [
    [
      "יִדְּעֹנִי",
      "Yidoni"
    ]
  ],
  "N11": [
    [
      "בֵּית עֲבוֹדָה זָרָה",
      "place of idol worship"
    ]
  ],
  "N12": [
    [
      "אֶבֶן מַשְׂכִּית",
      "kneeling stone"
    ],
    [
      "הִשְׁתַּחֲוָאָה",
      "bowing"
    ]
  ],
  "N23": [
    [
      "עִיר הַנִּדַּחַת",
      "apostate city"
    ],
    [
      "עֲבוֹדָה זָרָה",
      "idol worship"
    ]
  ],
  "N24": [
    [
      "עִיר הַנִּדַּחַת",
      "apostate city"
    ],
    [
      "עֲבוֹדָה זָרָה",
      "idol worship"
    ]
  ],
  "N30": [
    [
      "חֻקּוֹת הַגּוֹיִם",
      "practices of other nations"
    ]
  ],
  "N36": [
    [
      "שְׁאֵלַת אוֹב",
      "consulting an Ov"
    ]
  ],
  "N37": [
    [
      "שְׁאֵלַת יִדְּעֹנִי",
      "consulting a Yidoni"
    ]
  ],
  "N40": [
    [
      "לֹא יִלְבַּשׁ",
      "do not cross-dress"
    ],
    [
      "בְּגָדִים",
      "clothing"
    ]
  ],
  "N45": [
    [
      "שְׂרִיטָה",
      "scarring"
    ]
  ],
  "N54": [
    [
      "אֲדוֹמִי",
      "Edomite"
    ]
  ],
  "N57": [
    [
      "בַּל תַּשְׁחִית",
      "do not destroy needlessly"
    ],
    [
      "הַשְׁחָתָה",
      "destruction"
    ]
  ],
  "N63": [
    [
      "חִלּוּל הַשֵּׁם",
      "desecrating Hashem's Name"
    ]
  ],
  "N64": [
    [
      "לֹא תְנַסּוּ",
      "do not test Hashem"
    ]
  ],
  "N65": [
    [
      "בֵּית הַמִּקְדָּשׁ",
      "Beis Hamikdash"
    ],
    [
      "אִסּוּר הַשְׁחָתָה",
      "prohibition against destroying"
    ]
  ],
  "N157": [
    [
      "מוֹצָא שְׂפָתֶיךָ",
      "what you promise"
    ],
    [
      "הֲפָרַת הַבְטָחָה",
      "breaking a promise"
    ]
  ],
  "N176": [
    [
      "שְׁרָצִים",
      "creeping creatures"
    ]
  ],
  "N183": [
    [
      "גִּיד הַנָּשֶׁה",
      "sciatic nerve"
    ]
  ],
  "N215": [
    [
      "כִּלְאַיִם",
      "forbidden mixtures"
    ],
    [
      "זְרָעִים",
      "seeds"
    ]
  ],
  "N243": [
    [
      "גְּנֵבַת נֶפֶשׁ",
      "kidnapping"
    ]
  ],
  "N247": [
    [
      "עֹשֶׁק",
      "withholding money owed"
    ],
    [
      "שָׂכָר",
      "wages"
    ]
  ],
  "N250": [
    [
      "יֹשֶׁר",
      "honesty"
    ],
    [
      "מִשָּׂא וּמַתָּן",
      "commerce"
    ]
  ],
  "N251": [
    [
      "אוֹנָאַת דְּבָרִים",
      "hurtful words"
    ]
  ],
  "N252": [
    [
      "אוֹנָאַת דְּבָרִים",
      "hurtful words"
    ],
    [
      "גֵּר",
      "convert"
    ]
  ],
  "N273": [
    [
      "מִשְׁפַּט צֶדֶק",
      "just judgment"
    ],
    [
      "בֵּית דִּין",
      "court"
    ]
  ],
  "N275": [
    [
      "בַּעַל דִּין",
      "litigant"
    ],
    [
      "מַשּׂוֹא פָּנִים",
      "favoritism"
    ]
  ],
  "N277": [
    [
      "בַּעַל דִּין",
      "litigant"
    ],
    [
      "דַּל",
      "poor person"
    ]
  ],
  "N278": [
    [
      "בַּעַל דִּין",
      "litigant"
    ],
    [
      "דַּיָּן",
      "judge"
    ]
  ],
  "N280": [
    [
      "גֵּר",
      "convert"
    ],
    [
      "יָתוֹם",
      "orphan"
    ],
    [
      "מִשְׁפַּט צֶדֶק",
      "just judgment"
    ]
  ],
  "N281": [
    [
      "בַּעַל דִּין",
      "litigant"
    ],
    [
      "דַּיָּן",
      "judge"
    ]
  ],
  "N298": [
    [
      "מִכְשׁוֹל",
      "hazard"
    ],
    [
      "מַעֲקֶה",
      "safety railing"
    ]
  ],
  "N299": [
    [
      "עֵצָה רָעָה",
      "bad advice"
    ],
    [
      "לִפְנֵי עִוֵּר",
      "do not mislead another"
    ]
  ],
  "N303": [
    [
      "הַלְבָּנַת פָּנִים",
      "public shaming"
    ]
  ],
  "N340": [
    [
      "אִסּוּר עֲרָיוֹת",
      "prohibited relationships"
    ],
    [
      "דּוֹדָה",
      "aunt"
    ]
  ],
  "N341": [
    [
      "אִסּוּר עֲרָיוֹת",
      "prohibited relationships"
    ],
    [
      "דּוֹדָה",
      "aunt"
    ]
  ],
  "N346": [
    [
      "נִדָּה",
      "niddah"
    ],
    [
      "אִסּוּר עֲרָיוֹת",
      "prohibited relationships"
    ]
  ],
  "N347": [
    [
      "נִאוּף",
      "adultery"
    ]
  ],
  "N348": [
    [
      "רְבִיעָה",
      "forbidden relations with an animal"
    ],
    [
      "בְּהֵמָה",
      "animal"
    ]
  ],
  "N349": [
    [
      "רְבִיעָה",
      "forbidden relations with an animal"
    ],
    [
      "בְּהֵמָה",
      "animal"
    ]
  ],
  "N350": [
    [
      "מִשְׁכַּב זָכָר",
      "prohibited male relations"
    ]
  ],
  "N352": [
    [
      "אִסּוּר עֲרָיוֹת",
      "prohibited relationships"
    ],
    [
      "מִשְׁפָּחָה",
      "family"
    ]
  ],
  "N353": [
    [
      "פְּרִיצוּת",
      "immodest behavior"
    ]
  ],
  "N355": [
    [
      "אִסּוּר זְנוּת",
      "prohibited relations outside marriage"
    ]
  ],
  "N358": [
    [
      "גֵּט",
      "divorce document"
    ],
    [
      "אֹנֶס",
      "coercion"
    ]
  ],
  "N359": [
    [
      "מוֹצִיא שֵׁם רָע",
      "one who defames"
    ],
    [
      "גֵּט",
      "divorce document"
    ]
  ],
  "N360": [
    [
      "סְרִיס",
      "castrated man"
    ]
  ],
  "N361": [
    [
      "סֵרוּס",
      "castration"
    ]
  ],
  "P6": [
    [
      "חֲכָמִים",
      "sages"
    ],
    [
      "דְּבֵקוּת",
      "clinging to"
    ]
  ],
  "P8": [
    [
      "לָלֶכֶת בִּדְרָכָיו",
      "to follow Hashem's ways"
    ]
  ],
  "P16": [
    [
      "הַקְהֵל",
      "gathering the Jewish people"
    ],
    [
      "קָהָל",
      "assembly"
    ]
  ],
  "P94": [
    [
      "דִּבּוּר",
      "speech"
    ],
    [
      "קִיּוּם הַבְטָחָה",
      "keeping a promise"
    ]
  ],
  "P171": [
    [
      "מַחֲצִית הַשֶּׁקֶל",
      "half-shekel"
    ]
  ],
  "P177": [
    [
      "בַּעַל דִּין",
      "litigant"
    ],
    [
      "מִשְׁפַּט צֶדֶק",
      "fair judgment"
    ]
  ],
  "P181": [
    [
      "עֶגְלָה עֲרוּפָה",
      "decapitated calf"
    ]
  ],
  "P182": [
    [
      "עָרֵי מִקְלָט",
      "cities of refuge"
    ]
  ],
  "P193": [
    [
      "מַחֲנֶה",
      "camp"
    ],
    [
      "יָתֵד",
      "camp latrine peg"
    ]
  ],
  "P194": [
    [
      "הֲשָׁבַת גְּזֵלָה",
      "returning stolen property"
    ]
  ],
  "P212": [
    [
      "פְּרוּ וּרְבוּ",
      "be fruitful and multiply"
    ]
  ],
  "P218": [
    [
      "אֹנֶס",
      "coercion"
    ],
    [
      "בֵּית דִּין",
      "Jewish court"
    ]
  ],
  "P220": [
    [
      "מְפַתֶּה",
      "seducer"
    ],
    [
      "בֵּית דִּין",
      "Jewish court"
    ]
  ],
  "P230": [
    [
      "תְּלִיָּה",
      "hanging"
    ]
  ],
  "P246": [
    [
      "טַעֲנוֹת",
      "legal claims"
    ],
    [
      "בֵּית דִּין",
      "Jewish court"
    ]
  ],
  "N232": [
    [
      "עָנִי",
      "person in need"
    ],
    [
      "צְדָקָה",
      "tzedakah"
    ]
  ],
  "N239": [
    [
      "מַשְׁכּוֹן",
      "collateral"
    ],
    [
      "בַּעַל חוֹב",
      "debtor"
    ]
  ],
  "N270": [
    [
      "עֶזְרָה",
      "help"
    ],
    [
      "נִזְקָק",
      "person in need"
    ]
  ],
  "N297": [
    [
      "פִּקּוּחַ נֶפֶשׁ",
      "saving a life"
    ],
    [
      "הַצָּלָה",
      "rescue"
    ]
  ],
  "P114": [
    [
      "עֲרָכִין",
      "vowed valuation"
    ],
    [
      "עֵרֶךְ",
      "value"
    ]
  ],
  "P169": [
    [
      "אַרְבַּעַת הַמִּינִים",
      "the four species"
    ],
    [
      "אֶתְרוֹג",
      "esrog"
    ],
    [
      "לוּלָב",
      "lulav"
    ]
  ],
  "P196": [
    [
      "הַעֲנָקָה",
      "gifts at release"
    ],
    [
      "עֶבֶד עִבְרִי",
      "Jewish bondsman"
    ]
  ]
};
 const idOf=he=>'word:'+he.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('he');
 function topic(title){return title?'direct':'unreviewed';}
 function forRef(ref){
   const title=String(root.FTT_MITZVAH_TITLES&&root.FTT_MITZVAH_TITLES[ref]||'');
   if(!title)return [];
   const direct=overrides[ref];
   const pairs=direct||rules.filter(row=>row[0].test(title)).map(row=>row.slice(1));
   const seen=new Set(),result=[];
   for(const pair of pairs){
     const id=idOf(pair[0]);
     if(seen.has(id))continue;
     seen.add(id);
     result.push({id,hebrew:pair[0],english:pair[1],source:'sefer-hamitzvos',topic:'direct'});
     if(result.length===3)break;
   }
   return result;
 }
 root.FTTSeferVocabulary={topic,forRef,title:ref=>'Sefer HaMitzvos · '+ref+' · '+(root.FTT_MITZVAH_TITLES[ref]||'')};
})(typeof window==='object'?window:globalThis);
