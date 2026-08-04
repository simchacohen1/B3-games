#!/usr/bin/env python3
from pathlib import Path
from html import escape
import re
import subprocess
from datetime import datetime

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "all-pages.html"
EXCLUDED = {"index.html", "all-pages.html"}

def get_title(path: Path) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
        match = re.search(r"<title[^>]*>(.*?)</title>", text, flags=re.I | re.S)
        if match:
            title = re.sub(r"\s+", " ", match.group(1)).strip()
            if title:
                return title
    except Exception:
        pass
    return path.stem.replace("_", " ").replace("-", " ").strip()

def last_changed(path: Path):
    try:
        value = subprocess.check_output(
            ["git", "log", "-1", "--format=%ct", "--", str(path.relative_to(ROOT))],
            cwd=ROOT,
            text=True,
        ).strip()
        return int(value) if value else 0
    except Exception:
        return 0

pages = []
for path in ROOT.rglob("*.html"):
    relative = path.relative_to(ROOT)
    if path.name.lower() in EXCLUDED:
        continue
    if any(part.startswith(".") for part in relative.parts):
        continue
    pages.append((last_changed(path), relative.as_posix(), get_title(path)))

pages.sort(key=lambda item: (-item[0], item[2].lower()))

cards = []
for timestamp, href, title in pages:
    changed = datetime.fromtimestamp(timestamp).strftime("%b %d, %Y") if timestamp else ""
    date_html = f'<span class="date">Updated {escape(changed)}</span>' if changed else ""
    cards.append(f'''
      <a class="card" href="{escape(href, quote=True)}">
        <span class="title">{escape(title)}</span>
        <span class="filename">{escape(href)}</span>
        {date_html}
      </a>''')

cards_html = "\n".join(cards) if cards else '''
      <div class="empty">No additional HTML pages have been uploaded yet.</div>'''

html = f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>All Pages</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      background: #f4f7fb;
      color: #172033;
    }}
    header {{
      background: white;
      border-bottom: 1px solid #dfe5ee;
      padding: 28px 20px;
      position: sticky;
      top: 0;
      z-index: 2;
    }}
    .wrap {{ max-width: 1000px; margin: auto; }}
    h1 {{ margin: 0 0 8px; font-size: 30px; }}
    p {{ margin: 0; color: #5d6879; }}
    main {{ padding: 24px 20px 50px; }}
    #search {{
      width: 100%;
      padding: 14px 16px;
      margin-bottom: 18px;
      border: 1px solid #cbd4e1;
      border-radius: 12px;
      font-size: 17px;
      background: white;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
    }}
    .card {{
      display: flex;
      flex-direction: column;
      gap: 7px;
      min-height: 130px;
      padding: 18px;
      text-decoration: none;
      color: inherit;
      background: white;
      border: 1px solid #dfe5ee;
      border-radius: 14px;
      box-shadow: 0 3px 10px rgba(20, 35, 60, .06);
      transition: transform .12s ease, box-shadow .12s ease;
    }}
    .card:hover {{
      transform: translateY(-2px);
      box-shadow: 0 7px 18px rgba(20, 35, 60, .12);
    }}
    .title {{ font-size: 19px; font-weight: 700; }}
    .filename {{ color: #667085; font-size: 13px; overflow-wrap: anywhere; }}
    .date {{ color: #8791a1; font-size: 12px; margin-top: auto; }}
    .empty {{ background: white; padding: 24px; border-radius: 14px; }}
    .home {{
      display: inline-block;
      margin-top: 12px;
      color: #2457c5;
      text-decoration: none;
      font-weight: 700;
    }}
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>All Pages</h1>
      <p>This list updates automatically whenever an HTML file is uploaded, renamed, or deleted.</p>
      <a class="home" href="index.html">← Main site</a>
    </div>
  </header>
  <main>
    <div class="wrap">
      <input id="search" type="search" placeholder="Search pages…" aria-label="Search pages">
      <div class="grid" id="grid">
{cards_html}
      </div>
    </div>
  </main>
  <script>
    const search = document.getElementById('search');
    const cards = [...document.querySelectorAll('.card')];
    search.addEventListener('input', () => {{
      const term = search.value.toLowerCase().trim();
      cards.forEach(card => {{
        card.style.display = card.textContent.toLowerCase().includes(term) ? '' : 'none';
      }});
    }});
  </script>
</body>
</html>
'''

OUTPUT.write_text(html, encoding="utf-8")
print(f"Generated {OUTPUT.name} with {len(pages)} page(s).")
