@echo off
chcp 65001 >nul
title 점심 메뉴 레이스
cd /d "%~dp0"

rem Python 실행기 탐색 (py 우선, 없으면 python)
where py >nul 2>nul
if %errorlevel%==0 (
    py serve.py
    goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
    python serve.py
    goto :eof
)

echo [안내] Python 이 설치되어 있지 않습니다.
echo Python 없이 실행하려면 index.html 을 브라우저로 직접 여세요.
echo (단, 음식 사진 기능은 로컬 서버에서만 정상 동작합니다)
echo.
echo index.html 을 기본 브라우저로 엽니다...
start "" "index.html"
pause
