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
import sys

PORT_START = 5173

os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    # 캐시 끄기(사진/코드 교체 즉시 반영)
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

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
