"""ゲーム用ローカルサーバー。public/ を配信し、修正ツールからの保存を受け付ける。

使い方: python tools/server.py  (start.bat から起動)
API:
  GET  /api/corrections        修正リストを返す
  POST /api/corrections        {"remove": [...], "set_height": [...], "add": [...]} を追記して city.json を再生成
  POST /api/corrections/undo   最後に保存した分を取り消して再生成
"""
import http.server
import json
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
CORR = ROOT / "data" / "corrections.json"
PORT = 8000


def load():
    if CORR.exists():
        return json.loads(CORR.read_text(encoding="utf-8"))
    return {"_note": "現地情報による修正。ファイルを消せば元データに戻る"}


def save(c):
    CORR.write_text(json.dumps(c, ensure_ascii=False, indent=1), encoding="utf-8")


def rebuild():
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "build_city.py")], capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.returncode == 0, (r.stdout + r.stderr)[-2000:]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(PUBLIC), **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # 再生成した city.json を確実に読ませる
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/corrections"):
            return self._json(200, load())
        return super().do_GET()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(n) or b"{}")
        c = load()
        if self.path == "/api/corrections":
            batch = int(time.time() * 1000)
            for key, src in (("remove_buildings", "remove"), ("set_height", "set_height"), ("add_buildings", "add")):
                for item in req.get(src, []):
                    c.setdefault(key, []).append({**item, "batch": batch})
        elif self.path == "/api/corrections/undo":
            batches = [i.get("batch", 0) for k in ("remove_buildings", "set_height", "add_buildings") for i in c.get(k, [])]
            last = max([b for b in batches if b] or [0])
            if not last:
                return self._json(200, {"ok": False, "message": "取り消せる保存がありません"})
            for k in ("remove_buildings", "set_height", "add_buildings"):
                c[k] = [i for i in c.get(k, []) if i.get("batch") != last]
        else:
            return self._json(404, {"ok": False})
        save(c)
        ok, log = rebuild()
        self._json(200 if ok else 500, {"ok": ok, "log": log})

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    print(f"http://localhost:{PORT}/  (Ctrl+C で終了)")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
