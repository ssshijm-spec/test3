#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
점심 메뉴 레이스 - 로컬 실행 서버
file:// 로 열면 브라우저가 로컬 음식 사진(assets/food/*)을 canvas 로 못 그리는 문제가 있어
간단한 로컬 웹서버로 띄운다. 더블클릭용 start.bat 가 이 파일을 실행한다.
"""
import http.server
import socketserver
import webbrowser
import os
import re
import sys
import json

PORT_START = 5173
HOF_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hof_local.json")

os.chdir(os.path.dirname(os.path.abspath(__file__)))


def _load_hof():
    try:
        with open(HOF_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_hof(data):
    try:
        with open(HOF_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass


class Handler(http.server.SimpleHTTPRequestHandler):
    """
    실제 서버(Cloudflare Pages Functions, functions/api/*.js)는 배포 시에만 동작하므로
    로컬 개발 중 명예의 전당 기능을 확인할 수 있도록 /api/win, /api/hof 를 여기서
    아주 단순하게 목업한다. 저장 파일(hof_local.json)은 로컬 테스트용일 뿐 배포와는
    무관하며 git에도 포함되지 않는다(.gitignore).
    """

    # 캐시 끄기(사진/코드 교체 즉시 반영)
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/hof":
            counts = _load_hof()
            total = sum(counts.values())
            top = sorted(counts.items(), key=lambda kv: -kv[1])[:5]
            out = [
                {"slug": slug, "count": c, "pct": round((c / total) * 1000) / 10 if total else 0}
                for slug, c in top
            ]
            self._json({"ok": True, "total": total, "top": out, "kv": True})
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/win":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length) or b"{}")
                slug = body.get("slug", "")
                if not re.match(r"^[a-z0-9-]{1,40}$", slug or ""):
                    self._json({"ok": False, "error": "invalid slug"}, 400)
                    return
                counts = _load_hof()
                counts[slug] = counts.get(slug, 0) + 1
                _save_hof(counts)
                self._json({"ok": True})
            except Exception:
                self._json({"ok": False, "error": "server error"}, 500)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, fmt, *args):  # 콘솔 조용히
        pass


def find_port(start):
    port = start
    for _ in range(50):
        try:
            with socketserver.TCPServer(("127.0.0.1", port), Handler) as _s:
                return port
        except OSError:
            port += 1
    return start


def main():
    port = find_port(PORT_START)
    url = f"http://127.0.0.1:{port}/index.html"
    with socketserver.TCPServer(("127.0.0.1", port), Handler) as httpd:
        print("=" * 48)
        print("  점심 메뉴 레이스 실행 중")
        print(f"  브라우저 주소: {url}")
        print("  종료하려면 이 창에서 Ctrl+C")
        print("=" * 48)
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n서버를 종료합니다.")
            sys.exit(0)


if __name__ == "__main__":
    main()
