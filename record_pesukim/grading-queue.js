(function(root){
  "use strict";

  const submissionsPath = "posukPractice/submissions";
  const isPending = submission => Boolean(submission?.id && submission.status === "pending");

  // options.classIds: only count these classes (the teacher's own). Leave it out to count every class (the owner's "All classes").
  function watchClassCounts(db, workspaceId, onCounts, onError, options){
    const onlyClasses = options && Array.isArray(options.classIds) ? new Set(options.classIds) : null;
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
        .filter(([id, row]) => /^[A-Za-z0-9_-]{1,100}$/.test(id) && row && row.active !== false && (!onlyClasses || onlyClasses.has(id)))
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
    // One marking place for all of my classes (ET and WT together), not one link per class.
    const href = "record_pesukim/teacher.html?view=marking";
    const classes = [...summary.classes].sort((a, b) => a.name.localeCompare(b.name));
    const card = document.createElement("div");
    card.className = "approval-center-item approval-center-item-with-classes";
    card.innerHTML = '<span class="approval-center-icon" aria-hidden="true">🎙️</span>' +
      '<span><strong><a class="approval-center-primary">Posuk Practice Recordings</a></strong>' +
      '<small>Recordings waiting to be graded. <span class="approval-center-class-split"></span></small></span>' +
      '<span class="approval-center-count"></span>';
    card.querySelector(".approval-center-primary").setAttribute("href", href);
    card.querySelector(".approval-center-count").textContent = String(summary.total);
    const split = card.querySelector(".approval-center-class-split");
    split.append("(");
    classes.forEach(({id, name, count}, index) => {
      if (index) split.append(" · ");
      const label = document.createElement("span");
      label.className = "approval-center-class-count";
      label.textContent = name + " " + count;
      split.append(label);
    });
    split.append(")");
    return card;
  }

  root.B3PosukGradingQueue = {submissionsPath, isPending, watchClassCounts, approvalCard};
})(window);
