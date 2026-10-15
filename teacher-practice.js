/* Persistent teacher-only student practice.
 * Real student records and rewards are never used for teacher work.
 * Guest demos remain deliberately ephemeral.
 */
(function (root) {
  'use strict';
  const IDENTIFIER = /^[A-Za-z0-9_-]{1,100}$/;
  const WORKSPACE = 'b3-2026';

  function safeId(id, label) {
    if (!IDENTIFIER.test(String(id || ''))) throw new Error('Invalid ' + label + '.');
    return String(id);
  }

  async function open(liveDb, user, access, tool) {
    if (!user || !user.uid || !access?.authorized || !['admin', 'teacher'].includes(access.role)) {
      throw new Error('Sign in with your teacher account to save practice work.');
    }
    const params = new URLSearchParams(location.search);
    const requested = params.get('class') || (access.classIds || [])[0] || (access.role === 'admin' ? 'et' : '');
    const classId = safeId(requested, 'class');
    const workspaceId = safeId(window.B3_WORKSPACE_ID || window.B3SiteSettings?.workspaceId || WORKSPACE, 'workspace');
    if (access.role !== 'admin' && !(access.classIds || []).includes(classId)) {
      throw new Error('This class is not assigned to your teacher account.');
    }
    const classSnap = await liveDb.ref('b3Games/workspaces/' + workspaceId + '/classes/' + classId).once('value');
    const record = classSnap.val();
    if (!record || record.active === false) throw new Error('This class is not active.');
    if (access.role !== 'admin' && record.toolGrants?.[tool] !== true) {
      throw new Error('This activity is not enabled for your class.');
    }
    const prefix = 'teacherPractice/' + workspaceId + '/' + safeId(user.uid, 'teacher') + '/' + classId;
    const path = suffix => prefix + (suffix ? '/' + String(suffix).replace(/^\/+/, '') : '');
    const matches = [
      ['posukPractice/attempts/teacher_preview', 'posuk/attempts'],
      ['posukPractice/students/teacher_preview', 'posuk/student'],
      ['posukPractice/chazara/students/teacher_preview', 'chazara/student'],
      ['posukPractice/chazara/events/teacher_preview', 'chazara/events']
    ];
    function mapped(original) {
      const source = String(original || '').replace(/^\/+/, '');
      for (const [from, to] of matches) {
        if (source === from || source.startsWith(from + '/')) return path(to + source.slice(from.length));
      }
      return '';
    }
    function readonlyReference(reference, original) {
      const fail = () => Promise.reject(new Error('Teacher practice cannot edit shared classroom records: ' + original));
      return new Proxy(reference, {
        get(target, property) {
          if (['set', 'update', 'remove', 'transaction', 'setWithPriority', 'setPriority', 'push'].includes(property)) return fail;
          if (property === 'child') return child => dbAdapter(liveDb).ref(String(original || '').replace(/\/$/, '') + '/' + child);
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
    }
    function dbAdapter(database) {
      return {
        ref(original = '') {
          const ownPath = mapped(original);
          if (ownPath) return database.ref(ownPath);
          return readonlyReference(database.ref(original), original);
        }
      };
    }
    function blobDataURL(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error || new Error('Could not read the recording.'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(blob);
      });
    }
    // Posuk Practice saves its audio URL inside each private attempt record.
    // A data URL, rather than a browser-only object URL, works after reload.
    function recordingStorage() {
      const audio = new Map();
      return {
        ref(key) {
          const name = String(key);
          return {
            put(blob) {
              const work = blobDataURL(blob).then(value => { audio.set(name, value); });
              return work;
            },
            async getDownloadURL() {
              if (!audio.has(name)) throw new Error('Recording must be saved before its link is requested.');
              return audio.get(name);
            },
            async delete() { audio.delete(name); }
          };
        },
        refFromURL(url) {
          return { async delete() {
            for (const [key, value] of audio) if (value === url) audio.delete(key);
          } };
        }
      };
    }
    return Object.freeze({
      userId: user.uid, classId, workspaceId, root: prefix,
      path, dbAdapter, recordingStorage, blobDataURL
    });
  }

  const api = {open};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.B3TeacherPractice = api;
})(typeof window === 'object' ? window : globalThis);
