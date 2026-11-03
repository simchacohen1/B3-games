/*
 * Guest Mode demo data for the Class Gallery: made-up students and made-up
 * posts, built here. Nothing is read from or written to the real gallery.
 */
(function () {
  "use strict";
  function art(bg, fg, emoji, label) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">' +
      '<rect width="640" height="480" fill="' + bg + '"/><circle cx="520" cy="90" r="46" fill="' + fg + '" opacity=".35"/>' +
      '<text x="320" y="270" font-size="170" text-anchor="middle">' + emoji + '</text>' +
      '<text x="320" y="410" font-size="34" font-family="Arial" font-weight="700" fill="' + fg + '" text-anchor="middle">' + label + '</text></svg>';
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }
  var rows = [
    ["Sample Student A", "My Sukkah Drawing", "Parsha", "hallway", "#fde68a", "#92400e", "⛺", "DEMO", "A picture of the sukkah we built in class."],
    ["Sample Student B", "Avraham's Tent", "Chumash", "hallway", "#bfdbfe", "#1e3a8a", "🏕️", "DEMO", "Avraham's tent was open on all four sides to welcome guests."],
    ["Sample Student C", "Shorashim Tree", "Other", "hallway", "#bbf7d0", "#14532d", "🌳", "DEMO", "I drew a tree with the shorashim I learned this week."],
    ["Sample Student D", "Hachnasas Orchim Poster", "Halacha", "halacha", "#fecaca", "#7f1d1d", "🍞", "DEMO", "A poster about welcoming guests."],
    ["Sample Student E", "Parsha Comic", "Parsha", "parsha", "#e9d5ff", "#581c87", "🐑", "DEMO", "A comic of the parsha story."],
    ["Sample Student F", "Perek Yud Ches Map", "Chumash", "perek18", "#fed7aa", "#7c2d12", "🗺️", "DEMO", "A map of the places in this perek."],
    ["Sample Student G", "Mazel Tov Card", "Other", "hallway", "#fbcfe8", "#831843", "🎉", "DEMO", "A card for a classmate's simcha."],
    ["Sample Student H", "Water for the Guests", "Chumash", "hallway", "#a5f3fc", "#164e63", "💧", "DEMO", "Avraham gave the guests water to wash their feet."]
  ];
  var posts = {};
  rows.forEach(function (r, i) {
    posts["demo_post_" + (i + 1)] = {
      studentId: "demo_student_" + (i + 1), studentName: r[0], className: "Demo Class",
      title: "DEMO · " + r[1], category: r[2], galleryRoom: r[3], description: r[8] + " (Sample post for Guest Mode.)",
      link: "", image: art(r[4], r[5], r[6], r[7]), audioUrl: null, videoUrl: null, status: "approved",
      createdAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString()
    };
  });
  // A tiny stand-in for firebase.database().ref(...): reads only, writes go nowhere.
  function makeRef() {
    var noop = function () { return Promise.resolve(); };
    var ref = {
      on: function (ev, cb) { setTimeout(function () { cb({ val: function () { return JSON.parse(JSON.stringify(posts)); } }); }, 0); return cb; },
      once: function () { return Promise.resolve({ val: function () { return JSON.parse(JSON.stringify(posts)); } }); },
      off: function () {}, set: noop, update: noop, remove: noop,
      push: function () { return { key: "demo_new_" + Date.now(), set: noop }; },
      child: function () { return ref; }
    };
    return ref;
  }
  window.addEventListener("DOMContentLoaded", function () {
    if (!(window.B3Guest && window.B3Guest.isGuest())) return;
    var tag = document.createElement("div");
    tag.textContent = "DEMO · made-up sample students";
    tag.style.cssText = "position:fixed;top:56px;right:10px;z-index:2147483000;background:#7c3aed;color:#fff;padding:6px 12px;border-radius:999px;font:700 13px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.3);pointer-events:none";
    document.body.appendChild(tag);
  });
  window.B3GalleryDemo = { posts: posts, makeRef: makeRef };
})();
