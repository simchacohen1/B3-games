(function(root){
  "use strict";

  const submissionsPath = "posukPractice/submissions";
  const isPending = submission => Boolean(submission?.id && submission.status === "pending");

  function watchClassCounts(db, workspaceId, onCounts, onError){
    const classesRef = db.ref("b3Games/workspaces/" + workspaceId + "/classes");
    const students = new Map();
    let classes = [];
    let watching = true;

    function publish(){
      if ([...students.values()].some(student => student.count === undefined && !student.error)) return;
      const byClass = classes.filter(({ids}) => ids.every(id => students.get(id).count !== undefined));
      // A student can appear in both class queues. Count their recordings once in the badge.
      const countedStudents = new Set(byClass.flatMap(({ids}) => ids));
      const total = [...countedStudents].reduce((sum, id) => sum + students.get(id).count, 0);
      const counts = byClass.map(({id, name, ids}) => ({
        id, name, count: ids.reduce((sum, studentId) => sum + students.get(studentId).count, 0)
      })).filter(({count}) => count > 0);
      onCounts({total, classes: counts}, [...students.values()].find(student => student.error)?.error);
    }

    function watchStudent(id, student){
      const ref = db.ref(submissionsPath + "/" + id);
      const onValue = snap => {
        if (students.get(id) !== student) return;
        student.count = Object.values(snap.val() || {}).filter(isPending).length;
        delete student.error;
        publish();
      };
      student.stop = () => ref.off("value", onValue);
      ref.on("value", onValue, error => {
        if (students.get(id) !== student) return;
        student.count = undefined;
        student.error = error;
        publish();
      });
    }

    const onClasses = snap => {
      if (!watching) return;
      classes = Object.entries(snap.val() || {})
        .filter(([id, row]) => /^[A-Za-z0-9_-]{1,100}$/.test(id) && row && row.active !== false)
        .map(([id, row]) => ({
          id,
          name: id === "et" || id === "wt" ? id.toUpperCase() : String(row.name || id).replace(/^B3\s+/i, ""),
          ids: Object.keys(row.members || {}).filter(studentId => row.members[studentId] && row.members[studentId].active !== false)
        }));
      const wanted = new Set(classes.flatMap(({ids}) => ids));
      for (const [id, student] of students){
        if (wanted.has(id)) continue;
        students.delete(id);
        student.stop();
      }
      const added = [...wanted].filter(id => !students.has(id));
      for (const id of added) students.set(id, {});
      for (const id of added) watchStudent(id, students.get(id));
      publish();
    };

    classesRef.on("value", onClasses, error => {
      if (watching) onError(error);
    });
    return () => {
      watching = false;
      classesRef.off("value", onClasses);
      const subscriptions = [...students.values()];
      students.clear();
      subscriptions.forEach(student => student.stop());
    };
  }

  function approvalCard(summary){
    const href = id => "record_pesukim/teacher.html?class=" + encodeURIComponent(id);
    const classes = [...summary.classes].sort((a, b) => a.name.localeCompare(b.name));
    const first = classes.reduce((best, entry) => entry.count > best.count ? entry : best);
    const card = document.createElement("div");
    card.className = "approval-center-item approval-center-item-with-classes";
    card.innerHTML = '<span class="approval-center-icon" aria-hidden="true">🎙️</span>' +
      '<span><strong><a class="approval-center-primary">Posuk Practice Recordings</a></strong>' +
      '<small>Recordings waiting to be graded. <span class="approval-center-class-split"></span></small></span>' +
      '<span class="approval-center-count"></span>';
    card.querySelector(".approval-center-primary").setAttribute("href", href(first.id));
    card.querySelector(".approval-center-count").textContent = String(summary.total);
    const split = card.querySelector(".approval-center-class-split");
    split.append("(");
    classes.forEach(({id, name, count}, index) => {
      if (index) split.append(" · ");
      const link = document.createElement("a");
      link.className = "approval-center-class-link";
      link.setAttribute("href", href(id));
      link.textContent = name + " " + count;
      split.append(link);
    });
    split.append(")");
    return card;
  }

  root.B3PosukGradingQueue = {submissionsPath, isPending, watchClassCounts, approvalCard};
})(window);
