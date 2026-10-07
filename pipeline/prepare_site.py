"""Include immutable official originals in the static deployment."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]

def main():
    dist = ROOT / "app/dist"
    if not (dist / "index.html").is_file():
        raise SystemExit("Build the app before preparing the static site.")
    shutil.copytree(ROOT / "data/raw", dist / "raw", dirs_exist_ok=True)
    (dist / ".nojekyll").write_text("")
    print("Official raw sources copied to", dist / "raw")

if __name__ == "__main__":
    main()
