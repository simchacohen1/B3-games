from pathlib import Path
import shutil
import sys

MARKER_STUDENT = "POSUK_STUDENT_APP_LOCK_V1"
MARKER_TEACHER = "POSUK_TEACHER_APP_TOGGLE_V1"

STUDENT_INJECT = '<!-- POSUK_STUDENT_APP_LOCK_V1 -->\n<style id="posukStudentAppLockStyle">\n  #studentAppClosedScreen { display: none; }\n  body.student-app-closed { margin: 0 !important; background: #f7f3e8 !important; }\n  body.student-app-closed > *:not(#studentAppClosedScreen):not(script):not(style) { display: none !important; }\n  body.student-app-closed #studentAppClosedScreen {\n    display: flex !important;\n    min-height: 100vh;\n    align-items: center;\n    justify-content: center;\n    padding: 28px;\n    box-sizing: border-box;\n    text-align: center;\n    font-family: Arial, sans-serif;\n  }\n  #studentAppClosedCard { max-width: 560px; }\n  #studentAppClosedIcon { font-size: 4rem; line-height: 1; margin-bottom: 18px; }\n  #studentAppClosedTitle {\n    font-size: clamp(2rem, 6vw, 3rem);\n    font-weight: 800;\n    margin: 0 0 12px;\n    color: #312a1e;\n  }\n  #studentAppClosedText { font-size: 1.15rem; color: #6a5d49; margin: 0; }\n</style>\n\n<div id="studentAppClosedScreen" aria-live="polite">\n  <div id="studentAppClosedCard">\n    <div id="studentAppClosedIcon">🔒</div>\n    <h1 id="studentAppClosedTitle">Currently Closed</h1>\n    <p id="studentAppClosedText">This practice page is currently closed.</p>\n  </div>\n</div>\n\n<script>\n(function () {\n  try {\n    if (!window.firebase || !firebase.database) return;\n\n    const appOpenRef = firebase.database().ref(\'posukPractice/settings/studentAppOpen\');\n    let previousState = null;\n\n    function applyState(isOpen) {\n      document.body.classList.toggle(\'student-app-closed\', !isOpen);\n    }\n\n    appOpenRef.on(\'value\', function (snap) {\n      const isOpen = snap.val() !== false;\n\n      if (previousState !== null && previousState !== isOpen) {\n        window.location.reload();\n        return;\n      }\n\n      previousState = isOpen;\n      applyState(isOpen);\n    }, function (err) {\n      console.error(\'Could not read student app open/closed setting:\', err);\n      applyState(true);\n    });\n  } catch (err) {\n    console.error(\'Student app lock failed to initialize:\', err);\n  }\n})();\n</script>'
TEACHER_INJECT = '<!-- POSUK_TEACHER_APP_TOGGLE_V1 -->\n<style id="posukTeacherAppToggleStyle">\n  #studentAppToggleDock {\n    position: fixed;\n    right: 18px;\n    bottom: 18px;\n    z-index: 99999;\n    font-family: Arial, sans-serif;\n  }\n  #studentAppToggleBtn {\n    border-radius: 999px;\n    padding: 13px 18px;\n    min-height: 48px;\n    font-size: .95rem;\n    font-weight: 800;\n    cursor: pointer;\n    box-shadow: 0 4px 16px rgba(0,0,0,.18);\n  }\n  #studentAppToggleBtn[data-state="open"] {\n    background: #dff3df;\n    color: #1f5e2a;\n    border: 2px solid #2f7b3d;\n  }\n  #studentAppToggleBtn[data-state="closed"] {\n    background: #f8dede;\n    color: #7a2020;\n    border: 2px solid #a83232;\n  }\n  #studentAppToggleBtn[data-state="loading"] {\n    background: #eee;\n    color: #555;\n    border: 2px solid #aaa;\n  }\n  #studentAppToggleBtn:disabled {\n    cursor: wait;\n    opacity: .75;\n  }\n</style>\n\n<div id="studentAppToggleDock">\n  <button id="studentAppToggleBtn" type="button" data-state="loading" disabled>\n    Checking Student App…\n  </button>\n</div>\n\n<script>\n(function () {\n  try {\n    if (!window.firebase || !firebase.database) return;\n\n    const btn = document.getElementById(\'studentAppToggleBtn\');\n    const appOpenRef = firebase.database().ref(\'posukPractice/settings/studentAppOpen\');\n    let currentOpen = true;\n    let loaded = false;\n\n    function render() {\n      if (!loaded) {\n        btn.dataset.state = \'loading\';\n        btn.textContent = \'Checking Student App…\';\n        btn.disabled = true;\n        return;\n      }\n\n      btn.disabled = false;\n      if (currentOpen) {\n        btn.dataset.state = \'open\';\n        btn.textContent = \'🟢 Student App OPEN\';\n        btn.title = \'Click to close the student practice page\';\n      } else {\n        btn.dataset.state = \'closed\';\n        btn.textContent = \'🔴 Student App CLOSED\';\n        btn.title = \'Click to open the student practice page\';\n      }\n    }\n\n    appOpenRef.on(\'value\', function (snap) {\n      currentOpen = snap.val() !== false;\n      loaded = true;\n      render();\n    }, function (err) {\n      console.error(\'Could not read student app setting:\', err);\n      btn.dataset.state = \'loading\';\n      btn.textContent = \'⚠️ Could not load app switch\';\n      btn.disabled = true;\n    });\n\n    btn.addEventListener(\'click\', async function () {\n      if (!loaded) return;\n\n      const newState = !currentOpen;\n      btn.disabled = true;\n      btn.textContent = newState ? \'Opening…\' : \'Closing…\';\n\n      try {\n        await appOpenRef.set(newState);\n      } catch (err) {\n        console.error(\'Could not change student app setting:\', err);\n        alert(\'Could not change the student app setting. Please try again.\');\n        render();\n      }\n    });\n  } catch (err) {\n    console.error(\'Teacher app toggle failed to initialize:\', err);\n  }\n})();\n</script>'

def inject_before_body_close(path, marker, block):
    if not path.exists():
        raise FileNotFoundError(f"Could not find {path.name}")

    text = path.read_text(encoding="utf-8")

    if marker in text:
        print(f"{path.name}: already installed. Skipping.")
        return

    pos = text.lower().rfind("</body>")
    if pos == -1:
        raise RuntimeError(f"{path.name}: could not find </body>")

    backup = path.with_name(path.name + ".bak-before-app-lock")
    if not backup.exists():
        shutil.copy2(path, backup)
        print(f"{path.name}: backup created -> {backup.name}")

    updated = text[:pos] + "\n\n" + block.strip() + "\n\n" + text[pos:]
    path.write_text(updated, encoding="utf-8")
    print(f"{path.name}: updated successfully.")

def main():
    folder = Path(__file__).resolve().parent
    student = folder / "student.html"
    teacher = folder / "teacher.html"

    print()
    print("Posuk Practice - Student App Open/Close Installer")
    print("------------------------------------------------")
    print(f"Folder: {folder}")
    print()

    try:
        inject_before_body_close(student, MARKER_STUDENT, STUDENT_INJECT)
        inject_before_body_close(teacher, MARKER_TEACHER, TEACHER_INJECT)
    except Exception as e:
        print()
        print("ERROR:", e)
        print()
        print("Put these installer files in the SAME folder as student.html and teacher.html.")
        print()
        input("Press Enter to close...")
        sys.exit(1)

    print()
    print("DONE.")
    print("Teacher page: OPEN/CLOSED button added at bottom-right.")
    print("Student page: locked screen added when CLOSED.")
    print("Firebase setting: posukPractice/settings/studentAppOpen")
    print("Missing setting defaults to OPEN.")
    print()
    print("Backups were created before changes.")
    print("Now commit/push student.html and teacher.html to GitHub.")
    print()
    input("Press Enter to close...")

if __name__ == "__main__":
    main()
