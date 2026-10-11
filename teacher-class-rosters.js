(function () {
  "use strict";
  // Shared, authenticated roster lookup for teacher-only class tools.
  // An unassigned class ID in a URL never grants access to its roster.
  const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
  const ROOT = "b3Games/workspaces/" + (window.B3SiteSettings?.workspaceId || "b3-2026") + "/classes";
  async function load() {
    if (!window.B3SiteSettings || !window.firebase || !firebase.database) {
      throw new Error("Teacher sign-in is unavailable. Open this tool from your Teacher Center.");
    }
    const session = await new Promise((resolve, reject) => {
      let resolved = false;
      window.B3SiteSettings.onAuthStateChanged((user, authorized, access) => {
        if (resolved) return;
        resolved = true;
        if (!user || !authorized || !access?.authorized || !["teacher", "admin"].includes(access.role)) {
          reject(new Error("Sign in to your authorized teacher account in Teacher Center to view your class."));
        } else {
          resolve({ user, access });
        }
      });
    });
    const db = firebase.database();
    const requested = (new URLSearchParams(location.search).get("class") || "").trim();
    if (requested && !SAFE_ID.test(requested)) throw new Error("Invalid class selection.");
    let allowed;
    if (session.access.role === "admin") {
      const all = (await db.ref(ROOT).once("value")).val() || {};
      allowed = Object.keys(all).filter(id => SAFE_ID.test(id) && all[id] && all[id].active !== false);
    } else {
      allowed = (session.access.classIds || []).filter(id => SAFE_ID.test(id));
    }
    if (requested && !allowed.includes(requested)) {
      throw new Error("This class is not assigned to your teacher account.");
    }
    const ids = requested ? [requested] : allowed;
    const rows = await Promise.all(ids.map(async id => {
      const cls = (await db.ref(ROOT + "/" + id).once("value")).val();
      if (!cls || cls.active === false) return null;
      const students = Object.values(cls.members || {})
        .filter(member => member && member.active !== false && member.name)
        .map(member => String(member.name).trim()).filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      return { id, name: String(cls.name || id), students };
    }));
    const classes = rows.filter(Boolean);
    if (requested && classes.length === 0) throw new Error("This class is unavailable.");
    if (!classes.length) throw new Error("No active classes are assigned to this teacher.");
    // Keep the familiar ET / WT order, followed by any other assigned classes.
    classes.sort((a, b) =>
      (a.id === "et" ? -2 : a.id === "wt" ? -1 : 0) -
      (b.id === "et" ? -2 : b.id === "wt" ? -1 : 0) ||
      a.name.localeCompare(b.name));
    return {
      classes, selectedId: requested || classes[0].id,
      uid: session.user.uid, role: session.access.role
    };
  }
  window.B3TeacherClassRosters = { load };
})();
