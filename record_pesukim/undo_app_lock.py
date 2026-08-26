from pathlib import Path
import shutil

FILES = ["student.html", "teacher.html"]
BACKUP_SUFFIX = ".bak-before-app-lock"
MODIFIED_SUFFIX = ".modified-with-app-lock"

def main():
    folder = Path(__file__).resolve().parent

    print()
    print("Posuk Practice - UNDO Student App Lock")
    print("--------------------------------------")
    print(f"Folder: {folder}")
    print()

    restored_any = False

    for name in FILES:
        current = folder / name
        backup = folder / (name + BACKUP_SUFFIX)
        saved_modified = folder / (name + MODIFIED_SUFFIX)

        if not backup.exists():
            print(f"{name}: backup not found ({backup.name})")
            continue

        if current.exists():
            if saved_modified.exists():
                saved_modified.unlink()
            shutil.copy2(current, saved_modified)
            print(f"{name}: saved current modified copy as {saved_modified.name}")

        shutil.copy2(backup, current)
        print(f"{name}: ORIGINAL restored from {backup.name}")
        restored_any = True

    print()
    if restored_any:
        print("UNDO COMPLETE.")
        print("Your original student.html and teacher.html have been restored.")
        print("If you already pushed the modified files to GitHub, commit and push the restored files.")
    else:
        print("Nothing was restored because the expected backup files were not found.")
        print("Put this undo tool in the SAME folder as the backup files.")

    print()
    input("Press Enter to close...")

if __name__ == "__main__":
    main()
