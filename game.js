/* =======================================================================
   점심 뭐 먹지: 구내식당 런!   (game.js — 엔진)
   백뷰 3인칭 픽셀아트 점심메뉴 레이싱. 60초 안에 종료.
   내부 가상 해상도 320x180, 정수 스케일 블릿. 픽셀 월드 + 크리스프 한글 오버레이.
   설계: lunch-race-design 워크플로우(게임필/메카닉/아트/콘텐츠 렌즈 + 종합) 스펙 기반.
   ======================================================================= */
(function () {
  'use strict';

  var CFG = window.CONFIG;

  /* ------------------------------------------------------------------ */
  /* 상수: 가상 해상도 / 도로 원근 (320x180 canonical space)             */
  /* ------------------------------------------------------------------ */
  var VW = 320, VH = 180;
  var HORIZON_Y = 68;      // 지평선
  var VPX = 160;           // 소실점 x (화면 중앙)
  var PLAYER_Y = 150;      // 러너 발 baseline
  var GATE_Y = 143;        // 카드 커밋(선택) 평면
  var LANE_FRAC = [-0.62, 0, 0.62];   // 0=좌,1=중,2=우

  var INTRO_END = 3.0;
  var FINISH_DUR = 2.0;
  var RC = Math.max(1, CFG.roundCount || 9);
  // 라운드 길이 = (완주시간 - 인트로 - 완주연출) / 라운드수. raceSeconds 를 키우면 라운드가 길어져 메뉴 확인 시간이 늘어난다.
  var RLEN = Math.max(4, ((CFG.raceSeconds || 40) - INTRO_END - FINISH_DUR) / RC);
  // 마지막 라운드는 절반 길이로 빠르게 마무리 -> 그만큼 절약된 시간이 배식장소 도착(감속) 연출에 통째로 더해진다.
  var NORMAL_ROUNDS = RC - 1;
  var LAST_RLEN = RLEN * 0.5;
  var RACE_ROUNDS_END = INTRO_END + NORMAL_ROUNDS * RLEN + LAST_RLEN;   // 라운드 종료(마지막 라운드 단축 반영)
  var FINISH_END = INTRO_END + RC * RLEN + FINISH_DUR;                  // 완주 시각(= raceSeconds, 기존과 동일하게 유지)
  var CELE_LEN = 12.0;

  // 라운드 내부 서브페이즈 경계 비율. 실제 초 단위 값은 라운드마다(마지막 라운드는 짧게) setupRound()에서
  // G.tSpawn/G.tApproach/G.tPick/G.tResolve/G.tCarry 로 계산해 저장한다.
  var SUB_SPAWN_FRAC = 0.05, SUB_APPROACH_FRAC = 0.86, SUB_PICK_FRAC = 0.90, SUB_RESOLVE_FRAC = 0.96;

  /* ------------------------------------------------------------------ */
  /* 팔레트 & 색 유틸                                                    */
  /* ------------------------------------------------------------------ */
  var PALETTE = ['#0d0b1a','#241b2f','#46394f','#7b6d8d','#b9a9c9','#cfeeff','#7fd4ff',
    '#ffd98a','#ffb26b','#f5f5ef','#d9d5c8','#8a8577','#6a6558','#b0ab9a','#ffe14d',
    '#c79a2e','#ff6b6b','#d43d3d','#2e4a8f','#5a7fd6','#3fae6b','#1f7a4d','#f0904a','#7a4a2a'];
  var PAL_RGB = PALETTE.map(hexToRgb);

  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function darken(hex, amt) {
    var c = hexToRgb(hex);
    return 'rgb(' + Math.round(c[0] * (1 - amt)) + ',' + Math.round(c[1] * (1 - amt)) + ',' + Math.round(c[2] * (1 - amt)) + ')';
  }
  function lighten(hex, amt) {
    var c = hexToRgb(hex);
    return 'rgb(' + Math.round(c[0] + (255 - c[0]) * amt) + ',' + Math.round(c[1] + (255 - c[1]) * amt) + ',' + Math.round(c[2] + (255 - c[2]) * amt) + ')';
  }
  function nearestPalette(r, g, b) {
    var best = 0, bd = 1e9;
    for (var i = 0; i < PAL_RGB.length; i++) {
      var p = PAL_RGB[i];
      var d = (r - p[0]) * (r - p[0]) + (g - p[1]) * (g - p[1]) + (b - p[2]) * (b - p[2]);
      if (d < bd) { bd = d; best = i; }
    }
    return PAL_RGB[best];
  }

  /* ------------------------------------------------------------------ */
  /* 수학 / 이징                                                         */
  /* ------------------------------------------------------------------ */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randi(a, b) { return Math.floor(rand(a, b + 1)); }
  function easeOutBack(t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }

  // 도로 원근
  function roadHalfWidth(y) {
    var t = clamp((y - HORIZON_Y) / (VH - HORIZON_Y), 0, 1);
    return 6 + 154 * Math.pow(t, 1.6);
  }
  function laneX(y, L) { return VPX + LANE_FRAC[L] * roadHalfWidth(y); }
  function depthZ(y) { return 2400 / (y - HORIZON_Y + 2); }
  var HW_PLAYER = roadHalfWidth(PLAYER_Y);

  /* ------------------------------------------------------------------ */
  /* 캔버스 & 스케일링                                                   */
  /* ------------------------------------------------------------------ */
  var display = document.getElementById('game');
  var dctx = display.getContext('2d');
  var buffer = document.createElement('canvas');
  buffer.width = VW; buffer.height = VH;
  var bctx = buffer.getContext('2d');
  bctx.imageSmoothingEnabled = false;
  var SCALE = 3;

  // 모바일 대응: 내부 렌더는 정수 배율(선명도), 화면 표시(CSS 크기)는 뷰포트를 최대한
  // 채우는 분수 배율로 분리 — 세로(포트레이트) 폰에서도 canvas가 작은 상자로 쪼그라들지 않고
  // 화면 폭/높이를 최대로 채운다. image-rendering:pixelated 덕분에 분수 확대에도 각지게 보인다.
  function resize() {
    var vp = window.visualViewport;
    var vw = vp ? vp.width : window.innerWidth;
    var vh = vp ? vp.height : window.innerHeight;
    var aspect = VW / VH;
    var cssW, cssH;
    if (vw / vh > aspect) { cssH = vh; cssW = vh * aspect; }
    else { cssW = vw; cssH = vw / aspect; }
    var dpr = window.devicePixelRatio || 1;
    SCALE = Math.max(1, Math.min(8, Math.round((cssW / VW) * dpr)));
    display.width = Math.round(VW * SCALE);
    display.height = Math.round(VH * SCALE);
    display.style.width = Math.round(cssW) + 'px';
    display.style.height = Math.round(cssH) + 'px';
    dctx.imageSmoothingEnabled = false;
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  resize();

  // 오버레이(크리스프 텍스트) 좌표 매핑 — 셰이크 포함
  function mapX(bx) { return (bx + G.shakeX) * SCALE; }
  function mapY(by) { return (by + G.shakeY) * SCALE; }

  /* ------------------------------------------------------------------ */
  /* 텍스트 오버레이 (한글 가독성: 디스플레이 캔버스에 크리스프 렌더)     */
  /* ------------------------------------------------------------------ */
  // 픽셀 폰트(neodgm). 픽셀 폰트라 굵기는 normal 고정(가짜 볼드 방지), 임팩트는 크기+아웃라인으로.
  var FONT = "'neodgm', 'Malgun Gothic', system-ui, sans-serif";
  function fitFont(px, text, maxW) {
    dctx.font = px + 'px ' + FONT;
    var w = dctx.measureText(text).width;
    if (w > maxW && w > 0) px = px * (maxW / w);
    return px;
  }
  function drawText(text, bx, by, bpx, color, opts) {
    opts = opts || {};
    var px = bpx * SCALE;
    if (opts.maxW) px = fitFont(px, text, opts.maxW * SCALE);
    dctx.font = px + 'px ' + FONT;
    dctx.textAlign = opts.align || 'center';
    dctx.textBaseline = opts.baseline || 'middle';
    var x = mapX(bx), y = mapY(by);
    if (opts.shadow !== false) {
      dctx.lineJoin = 'round';
      dctx.lineWidth = Math.max(2, px * (opts.outline || 0.14));
      dctx.strokeStyle = opts.outlineColor || '#0d0b1a';
      dctx.globalAlpha = (opts.alpha != null ? opts.alpha : 1);
      dctx.strokeText(text, x, y);
    }
    dctx.globalAlpha = (opts.alpha != null ? opts.alpha : 1);
    dctx.fillStyle = color;
    dctx.fillText(text, x, y);
    dctx.globalAlpha = 1;
  }
  // 캐릭터 말풍선(머리 위, 꼬리 아래). bx,by = 꼬리가 가리키는 지점(머리 위).
  function drawBubble(text, bx, by, bpx, alpha, bias) {
    var fs = bpx * SCALE;
    dctx.font = fs + 'px ' + FONT;
    var tw = dctx.measureText(text).width;
    var padX = 5 * SCALE, padY = 3.5 * SCALE, r = 4 * SCALE;
    var w = tw + padX * 2, h = fs + padY * 2;
    var ax = mapX(bx), ay = mapY(by);
    // bias: 0=중앙(꼬리 가운데), -1=왼쪽으로 뻗음(꼬리 오른쪽), +1=오른쪽으로 뻗음(꼬리 왼쪽)
    var tail = 6 * SCALE;
    var bxr = (bias < 0) ? (ax - w + tail) : (bias > 0) ? (ax - tail) : (ax - w / 2);
    var byr = ay - 9 * SCALE - h;
    bxr = Math.max(3 * SCALE, Math.min(display.width - w - 3 * SCALE, bxr));
    byr = Math.max(2 * SCALE, byr);
    dctx.globalAlpha = (alpha != null ? alpha : 1);
    // 꼬리(먼저, 박스가 밑변을 덮도록)
    dctx.beginPath();
    dctx.moveTo(ax - 5 * SCALE, byr + h); dctx.lineTo(ax + 5 * SCALE, byr + h); dctx.lineTo(ax, ay - 1 * SCALE);
    dctx.closePath();
    dctx.fillStyle = '#f8f6ee'; dctx.fill();
    dctx.lineWidth = Math.max(2, 1.2 * SCALE); dctx.strokeStyle = '#241b2f'; dctx.stroke();
    // 박스
    dctx.beginPath();
    if (dctx.roundRect) dctx.roundRect(bxr, byr, w, h, r); else dctx.rect(bxr, byr, w, h);
    dctx.fillStyle = '#f8f6ee'; dctx.fill();
    dctx.lineWidth = Math.max(2, 1.2 * SCALE); dctx.strokeStyle = '#241b2f'; dctx.stroke();
    // 텍스트
    dctx.textAlign = 'center'; dctx.textBaseline = 'middle';
    dctx.fillStyle = '#241b2f';
    dctx.fillText(text, bxr + w / 2, byr + h / 2);
    dctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ */
  /* 입력                                                                */
  /* ------------------------------------------------------------------ */
  var lastSteerAt = -1;
  function steer(dir) {
    if (G.macro !== 'RACE' || !subAllowsInput()) return;
    if (G.clock - lastSteerAt < 0.09) return;   // 90ms 디바운스
    lastSteerAt = G.clock;
    G.runner.targetLane = clamp(G.runner.targetLane + dir, 0, 2);
  }
  function subAllowsInput() {
    return G.sub === 'APPROACH' || G.sub === 'PICK';
  }
  function primaryAction(nx) {
    // nx: 0..1 정규화 x (탭/클릭 위치). 셀레브레이션이면 재시작, 아니면 좌/우.
    if (!G.started) { startGame(); return; }
    if (G.macro === 'CELEBRATION' && G.clock - FINISH_END > 1.5) { restart(); return; }
    if (nx == null) return;
    if (nx < 0.4) steer(-1); else if (nx > 0.6) steer(1);
  }
  window.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    var k = e.key;
    if (!G.started) {
      if (k === ' ' || k === 'Enter') { startGame(); e.preventDefault(); }
      return;
    }
    if (G.macro === 'CELEBRATION') {
      if (k === 'r' || k === 'R' || k === ' ' || k === 'Enter') { restart(); e.preventDefault(); }
      return;
    }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { steer(-1); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { steer(1); e.preventDefault(); }
  });
  function pointerX(e) {
    var r = display.getBoundingClientRect();
    var cx = (e.touches ? e.touches[0].clientX : e.clientX);
    return clamp((cx - r.left) / r.width, 0, 1);
  }
  display.addEventListener('mousedown', function (e) { primaryAction(pointerX(e)); });
  var touchStartX = null;
  display.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (!G.started) { startGame(); return; }
    if (G.macro === 'CELEBRATION') { if (G.clock - FINISH_END > 1.5) restart(); return; }
    touchStartX = e.touches[0].clientX;
  }, { passive: false });
  display.addEventListener('touchend', function (e) {
    if (touchStartX == null) return;
    var r = display.getBoundingClientRect();
    var endX = (e.changedTouches[0].clientX);
    var dx = endX - touchStartX;
    if (Math.abs(dx) >= 30) { steer(dx > 0 ? 1 : -1); }
    else { primaryAction(clamp((touchStartX - r.left) / r.width, 0, 1)); }
    touchStartX = null;
  });
  document.addEventListener('visibilitychange', function () {
    G.paused = document.hidden;
    if (!document.hidden) G.last = performance.now();
  });

  /* ------------------------------------------------------------------ */
  /* 오디오 (WebAudio 신스, 애셋 없음)                                   */
  /* ------------------------------------------------------------------ */
  var Audio = {
    ctx: null, master: null, bgmTimer: null, step: 0, bgmGain: null,
    init: function () {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.22;
      this.bgmGain.connect(this.master);
    },
    tone: function (type, freqs, durMs, gain, sweepTo, dest) {
      if (!this.ctx) return;
      var t0 = this.ctx.currentTime, dur = durMs / 1000;
      var g = this.ctx.createGain(); g.connect(dest || this.master);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      var step = dur / freqs.length;
      for (var i = 0; i < freqs.length; i++) {
        var o = this.ctx.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(freqs[i], t0 + i * step);
        if (sweepTo && i === freqs.length - 1) o.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
        o.connect(g); o.start(t0 + i * step); o.stop(t0 + dur + 0.02);
      }
    },
    noise: function (durMs, gain, fFrom, fTo, dest) {
      if (!this.ctx) return;
      var t0 = this.ctx.currentTime, dur = durMs / 1000;
      var n = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      var buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      var src = this.ctx.createBufferSource(); src.buffer = buf;
      var bq = this.ctx.createBiquadFilter(); bq.type = 'lowpass';
      bq.frequency.setValueAtTime(fFrom, t0); bq.frequency.linearRampToValueAtTime(fTo, t0 + dur);
      var g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bq); bq.connect(g); g.connect(dest || this.master);
      src.start(t0); src.stop(t0 + dur);
    },
    sfx: function (name) {
      if (!this.ctx) return;
      switch (name) {
        case 'beep': this.tone('square', [880], 120, 0.30); break;
        case 'go': this.tone('square', [523, 784, 1046], 260, 0.5, 1200); break;
        case 'footstep': this.noise(55, 0.14, 400, 120); break;
        case 'cardApproach': this.tone('triangle', [330, 440], 130, 0.18, 520); break;
        case 'select': this.tone('square', [660, 990], 170, 0.42, 1320); break;
        case 'shatter': this.noise(210, 0.35, 3000, 300); break;
        case 'championRetain': this.tone('sine', [784, 988], 200, 0.32); break;
        case 'championUpgrade': this.tone('square', [523, 659, 880, 1046], 340, 0.48, 1400); break;
        case 'whoosh': this.noise(280, 0.26, 200, 2400); break;
        case 'comboUp': this.tone('triangle', [660, 880, 1100], 220, 0.38); break;
        case 'finishLine': this.tone('square', [1046, 1318], 400, 0.5, 1568); break;
        case 'winnerFanfare': this.tone('square', [523, 659, 784, 1046, 1318], 900, 0.5); break;
        case 'confetti': this.noise(500, 0.22, 800, 4000); break;
      }
    },
    startBgm: function () {
      if (!this.ctx || this.bgmTimer) return;
      var self = this;
      this.step = 0;
      // 140bpm, 16분음표 스텝
      var stepMs = (60000 / 140) / 4;
      var bass = [131, 131, 196, 131];        // 마디당 4박(8분 게이트 근사)
      var arp = [523, 659, 784, 988];
      this.bgmTimer = setInterval(function () {
        if (!self.ctx || self.ctx.state !== 'running') return;
        var s = self.step % 16;
        var beat = Math.floor(s / 4);
        // 킥: 4-on-floor
        if (s % 4 === 0) self.noise(90, 0.20, 160, 60, self.bgmGain);
        // 베이스: 각 박 시작
        if (s % 4 === 0) self.tone('triangle', [bass[beat]], 200, 0.16, null, self.bgmGain);
        // 아르페지오: 8분마다
        if (s % 2 === 0) self.tone('square', [arp[(s / 2) % 4]], 90, 0.07, null, self.bgmGain);
        self.step++;
      }, stepMs);
    },
    stopBgm: function () { if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; } },
  };

  /* ------------------------------------------------------------------ */
  /* 메뉴 애셋: 얼굴 버퍼(플레이스홀더 즉시 생성, 사진은 로드되면 교체)   */
  /* ------------------------------------------------------------------ */
  // 얼굴 버퍼 해상도(높게) — 카드 위에는 디스플레이 오버레이로 선명하게 렌더된다.
  var FACE = 144;
  function buildPlaceholderFace(menu) {
    var c = document.createElement('canvas'); c.width = FACE; c.height = FACE;
    var g = c.getContext('2d'); g.imageSmoothingEnabled = true;
    g.fillStyle = menu.color; g.fillRect(0, 0, FACE, FACE);
    // 은은한 대각 스트라이프(티켓 느낌)
    g.fillStyle = darken(menu.color, 0.14);
    for (var k = -FACE; k < FACE; k += 12) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + FACE, FACE); g.lineWidth = 3; g.strokeStyle = darken(menu.color, 0.12); g.stroke(); }
    // 이모지(선명)
    var ec = document.createElement('canvas'); ec.width = 110; ec.height = 110;
    var eg = ec.getContext('2d');
    eg.textAlign = 'center'; eg.textBaseline = 'middle';
    eg.font = '86px "Segoe UI Emoji", "Apple Color Emoji", system-ui';
    eg.fillText(menu.emoji, 55, 60);
    g.imageSmoothingEnabled = true;
    var pad = FACE * 0.14;
    g.drawImage(ec, 0, 0, 110, 110, pad, pad * 0.8, FACE - 2 * pad, FACE - 2 * pad);
    // 좌상단 하이라이트
    g.fillStyle = 'rgba(245,245,239,0.35)'; g.fillRect(2, 2, FACE - 4, 2); g.fillRect(2, 2, 2, FACE - 4);
    return c;
  }
  function buildPhotoFace(menu, img) {
    var c = document.createElement('canvas'); c.width = FACE; c.height = FACE;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    var iw = img.width, ih = img.height, side = Math.min(iw, ih);
    g.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, 0, 0, FACE, FACE); // 깔끔한 다운스케일
    // 팔레트 스냅/디더 없이 '약한 포스터라이즈'만 → 원래 색 유지, 살짝만 스타일라이즈
    try {
      var id = g.getImageData(0, 0, FACE, FACE), d = id.data, step = 20;
      for (var i = 0; i < d.length; i += 4) {
        d[i] = Math.min(255, Math.round(d[i] / step) * step);
        d[i + 1] = Math.min(255, Math.round(d[i + 1] / step) * step);
        d[i + 2] = Math.min(255, Math.round(d[i + 2] / step) * step);
      }
      g.putImageData(id, 0, 0);
    } catch (e) { /* 크로스오리진 등 실패 시 원본 유지 */ }
    return c;
  }
  // WemadePlay 로고 (복도 끝 벽 + 타이틀 화면에 노출)
  var LOGO = { img: null };
  (function () {
    var im = new Image();
    im.onload = function () { if (im.width > 0) LOGO.img = im; };
    im.src = 'wemadeplay.png';
  })();
  // 3콤보 동반 강아지(Goldie). 4x10 그리드, 셀 32px. row1(0,32)~(96,32)=달리기 4프레임.
  var DOG = { img: null };
  (function () {
    var im = new Image();
    im.onload = function () { if (im.width > 0) DOG.img = im; };
    im.src = 'Goldie_v02.png';
  })();

  /* ------------------------------------------------------------------ */
  /* 점심메뉴 명예의 전당 (서버: Cloudflare Pages Functions + KV)          */
  /* 서버가 아직 없거나(로컬) 응답이 없어도 게임 진행에는 전혀 영향 없음.  */
  /* ------------------------------------------------------------------ */
  // state: 'loading'(아직 응답 전) | 'ok'(순위 있음) | 'empty'(연결O·기록X) | 'error'(연결 실패)
  var HOF = { total: 0, top: [], state: 'loading' };
  function fetchHOF() {
    fetch('/api/hof').then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok !== false) {
        HOF.total = d.total || 0; HOF.top = d.top || [];
        HOF.state = HOF.top.length ? 'ok' : 'empty';
      } else { HOF.state = 'error'; }
    }).catch(function () { HOF.state = 'error'; /* 함수 미배포/오프라인 */ });
  }
  function reportWin(slug) {
    fetch('/api/win', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: slug }) })
      .catch(function () { });
  }
  fetchHOF();

  function loadMenus() {
    CFG.FOODS.forEach(function (m) {
      m.face = buildPlaceholderFace(m);
      m.hasPhoto = false;
      var exts = CFG.photoExts.slice();
      var tryNext = function () {
        if (!exts.length) return;
        var ext = exts.shift();
        var img = new Image();
        img.onload = function () {
          if (img.width > 0) { m.face = buildPhotoFace(m, img); m.hasPhoto = true; }
        };
        img.onerror = tryNext;
        img.src = CFG.photoDir + m.slug + '.' + ext;
      };
      tryNext();
    });
  }

  /* ------------------------------------------------------------------ */
  /* 게임 상태                                                           */
  /* ------------------------------------------------------------------ */
  var WINNER_LINES = [
    '🏆 오늘의 우승 점심 메뉴는... {menu}!',
    '드디어 식판에 {menu} 담았다!',
    '치열했던 배식대 대전의 승자는 {menu}!',
    '오늘 점심 확정: {menu} 되시겠습니다!',
    '{menu}, 전 레인을 뚫고 챔피언 등극!',
    '13시 정각, 위장이 원한 건 결국 {menu}였다.',
    '이변은 없었다 — {menu} 우승!',
    '동료들이 부러워할 선택, {menu}!',
    '맛있게 드세요, 오늘의 챔피언 {menu}!',
    '식판 위 최후의 승자, {menu} 🥢',
  ];
  var FLAVOR = ['레인을 골라, 골라!', '챔피언 사수!', '새 도전자 등장!', '흔들리지 마!',
    '이번 판이 점심을 가른다!', '식판 꽉 잡고 직진!', '국물이냐 볶음이냐!', '라스트 스퍼트!'];

  var G;
  function freshState() {
    return {
      started: false, clock: 0, last: 0, paused: false,
      macro: 'INTRO', sub: 'SPAWN', roundIndex: -1, rel: 0,
      roundLen: RLEN, tSpawn: RLEN * SUB_SPAWN_FRAC, tApproach: RLEN * SUB_APPROACH_FRAC, tPick: RLEN * SUB_PICK_FRAC, tResolve: RLEN * SUB_RESOLVE_FRAC, tCarry: RLEN,
      coworkerBubbleShown: false, dogFrame: 0,
      chaserBubShown: { c0: false, c2: false, c4: false }, chaserBub: [],
      runner: { targetLane: 1, x: laneX(PLAYER_Y, 1), phase: 0, lean: 0, lastFrame: -1 },
      champion: null,
      round: { cards: [], resolved: false, champLanePrev: -1 },
      travel: 0, speedMult: 1,
      shakeT: 0, shakeMag: 0, shakeX: 0, shakeY: 0,
      hitstop: 0, flash: 0, flashColor: '#fff4c2',
      particles: [], shards: [], confetti: [], dust: [],
      toast: null,
      stats: { retains: 0, upgrades: 0, combo: 0, bestCombo: 0 },
      finalWinner: null, winnerLine: '', typeChars: 0,
      goFired: false, finishFlashed: false, lamps: [], lampSpawn: 0, spawnSeq: 0,
      pickBoost: 0, surge: 0,
      warnedT30: false, warnedT10: false, announce: null, bubble: null,
      celebFired: false, celebConfettiT: 0, clock2: 0,
    };
  }
  G = freshState();

  function say(text) { G.bubble = { text: text, t: 0 }; }

  function startGame() {
    Audio.init();
    G = freshState();
    G.started = true;
    G.last = performance.now();
    setupRound(0, RC === 1 ? LAST_RLEN : RLEN);   // 라운드0은 항상 일반 길이(RC===1인 극단적 예외만 LAST_RLEN)
    Audio.startBgm();
    say('배고파 빨리 점심 먹으러 가야지!');
  }
  function restart() {
    Audio.stopBgm();
    G = freshState();
    G.started = true;
    G.last = performance.now();
    setupRound(0, RC === 1 ? LAST_RLEN : RLEN);   // 라운드0은 항상 일반 길이(RC===1인 극단적 예외만 LAST_RLEN)
    Audio.startBgm();
    say('배고파 빨리 점심 먹으러 가야지!');
  }

  /* ------------------------------------------------------------------ */
  /* 라운드 구성                                                         */
  /* ------------------------------------------------------------------ */
  function pickDistinct(n, exclude) {
    exclude = exclude || [];
    var pool = CFG.FOODS.filter(function (m) { return exclude.indexOf(m) < 0; });
    var out = [];
    for (var i = 0; i < n && pool.length; i++) {
      var idx = randi(0, pool.length - 1);
      out.push(pool[idx]); pool.splice(idx, 1);
    }
    return out;
  }
  function setupRound(ri, curLen) {
    G.roundIndex = ri;
    G.round.resolved = false;
    G.roundLen = curLen;
    G.tSpawn = curLen * SUB_SPAWN_FRAC;
    G.tApproach = curLen * SUB_APPROACH_FRAC;
    G.tPick = curLen * SUB_PICK_FRAC;
    G.tResolve = curLen * SUB_RESOLVE_FRAC;
    G.tCarry = curLen;
    var cards = [];
    if (ri === 0 || !G.champion) {
      var three = pickDistinct(3, []);
      for (var i = 0; i < 3; i++) cards.push({ menu: three[i], lane: i, isChamp: false, born: G.clock });
      G.round.champLanePrev = -1;
    } else {
      // 챔피언 레인(직전 레인 회피)
      var lane = randi(0, 2);
      if (lane === G.round.champLanePrev) lane = (lane + 1 + randi(0, 1)) % 3;
      var others = [0, 1, 2].filter(function (l) { return l !== lane; });
      var chal = pickDistinct(2, [G.champion]);
      cards.push({ menu: G.champion, lane: lane, isChamp: true, born: G.clock });
      cards.push({ menu: chal[0], lane: others[0], isChamp: false, born: G.clock });
      cards.push({ menu: chal[1], lane: others[1], isChamp: false, born: G.clock });
      G.round.champLanePrev = lane;
    }
    cards.sort(function (a, b) { return a.lane - b.lane; });
    G.round.cards = cards;
    Audio.sfx('whoosh');

    // 최종 배식대(마지막 라운드) 직전 "라스트 선택!!" 연출
    if (ri === RC - 1) {
      G.announce = { text: '라스트 선택!!', sub: '오늘의 챔피언을 확정하라', t: 0, color: '#ff6b6b' };
      addShake(6, 0.3); G.flash = 0.09; G.flashColor = '#ff6b6b';
      Audio.sfx('championUpgrade'); Audio.sfx('whoosh');
    }
  }

  function commitRound() {
    G.round.resolved = true;
    var cards = G.round.cards;
    var chosen = null;
    for (var i = 0; i < cards.length; i++) if (cards[i].lane === G.runner.targetLane) chosen = cards[i];
    if (!chosen) chosen = cards[1] || cards[0];
    var prev = G.champion;
    var retained = prev && chosen.menu === prev;
    G.champion = chosen.menu;
    chosen.chosen = true;
    chosen.punchT = 0;

    // 진 카드 파편화
    for (var j = 0; j < cards.length; j++) if (cards[j] !== chosen) spawnShatter(cards[j]);

    // 선택 주스
    var cx = laneX(GATE_Y, chosen.lane), cy = GATE_Y - 20;
    spawnParticles(cx, cy, 20, ['#ffe14d', '#f5f5ef', '#3fae6b']);
    G.flash = 0.07; G.flashColor = '#fff4c2';
    addShake(3, 0.15); G.hitstop = 0.09;
    chosen.ring = 0;

    var m = chosen.menu.name;
    if (retained) {
      G.stats.retains++; G.stats.combo++;   // 콤보는 1(첫 챔피언)에서 시작 → 방어 시 2,3,4...
      if (G.stats.combo > G.stats.bestCombo) G.stats.bestCombo = G.stats.combo;
      var cb = G.stats.combo;
      if (cb >= 6) say(m + ' 매일 먹고싶어!!');
      else if (cb === 5) say(m + ' 기다려!!!');
      else if (cb === 4) say(m + ' 빨리 먹고싶다!!!');
      else if (cb === 3) say(m + '!! 질리지 않아!!!!');
      else say('찬양하라 갓 ' + m + '!!');   // cb === 2
      G.toast = { text: cb >= 3 ? ('방어 성공! x' + cb + ' 콤보') : '방어 성공!', color: '#ffe14d', t: 0 };
      Audio.sfx(cb >= 3 ? 'comboUp' : 'championRetain');
      spawnParticles(cx, cy, 10, ['#ffe14d', '#c79a2e']);
    } else {
      G.stats.combo = 1;
      if (prev) {   // 메뉴 바뀜(역전)
        G.stats.upgrades++; say(m + '이 더 맛있겠는데?');
        G.toast = { text: '역전! 새 챔피언', color: '#3fae6b', t: 0 }; addShake(5, 0.18);
      } else {      // 첫 선택
        say('역시 점심엔 ' + m + '!');
        G.toast = { text: '첫 메뉴 등극!', color: '#3fae6b', t: 0 };
      }
      Audio.sfx(prev ? 'championUpgrade' : 'select');
      spawnParticles(cx, cy, 24, ['#ff6b6b', '#ffe14d', '#f5f5ef']);
    }
    Audio.sfx('select');
    // ▶ 선택할수록 점점 빨라지는 '연출': 누적 부스트 + 순간 가속 서지 (실제 라운드 타이밍은 시계 기반이라 불변)
    G.pickBoost += 0.16;
    G.surge = 1.0;
    Audio.sfx('whoosh');
  }

  /* ------------------------------------------------------------------ */
  /* 파티클 / 파편 / 컨페티 / 먼지                                        */
  /* ------------------------------------------------------------------ */
  function spawnParticles(x, y, n, colors) {
    for (var i = 0; i < n; i++) {
      var a = rand(0, Math.PI * 2), sp = rand(40, 130);
      G.particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
        life: rand(0.4, 0.65), max: 0.65, size: randi(1, 2), color: colors[randi(0, colors.length - 1)] });
    }
  }
  function spawnShatter(card) {
    var s = cardScaleFor(card), w = 52 * s, h = 64 * s;
    var cx = laneX(GATE_Y, card.lane), cy = GATE_Y - h / 2 + 4;
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
      G.shards.push({
        x: cx - w / 2 + c * w / 3, y: cy - h / 2 + r * h / 3, w: w / 3, h: h / 3,
        vx: (c - 1) * 90 + rand(-30, 30), vy: -70 - rand(0, 70), grav: 520,
        rot: 0, vr: rand(-6, 6), life: 0.5, max: 0.5, color: card.menu.color,
      });
    }
    Audio.sfx('shatter');
    G.dust.push({ x: cx, y: cy, n: 10 });
    spawnParticles(cx, cy, 8, ['#b9a9c9', '#f5f5ef']);
  }
  function spawnConfetti(n) {
    var cols = ['#ff6b6b', '#ffe14d', '#3fae6b', '#5a7fd6', '#f5f5ef'];
    for (var i = 0; i < n; i++) {
      var fromLeft = i % 2 === 0;
      G.confetti.push({
        x: fromLeft ? 8 : VW - 8, y: VH - 8,
        vx: fromLeft ? rand(20, 90) : rand(-90, -20), vy: rand(-160, -90), grav: 220,
        life: rand(2.0, 2.8), max: 2.8, size: randi(2, 3), rot: rand(0, 6), vr: rand(-8, 8),
        color: cols[randi(0, cols.length - 1)],
      });
    }
  }
  function addShake(mag, dur) { G.shakeMag = Math.max(G.shakeMag, mag); G.shakeT = Math.max(G.shakeT, dur); }

  function updateParticles(dt) {
    var i;
    for (i = G.particles.length - 1; i >= 0; i--) {
      var p = G.particles[i];
      p.vy += 620 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) G.particles.splice(i, 1);
    }
    for (i = G.shards.length - 1; i >= 0; i--) {
      var s = G.shards[i];
      s.vy += s.grav * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.rot += s.vr * dt; s.life -= dt;
      if (s.life <= 0) G.shards.splice(i, 1);
    }
    for (i = G.confetti.length - 1; i >= 0; i--) {
      var cf = G.confetti[i];
      cf.vy += cf.grav * dt; cf.x += cf.vx * dt; cf.y += cf.vy * dt; cf.rot += cf.vr * dt; cf.life -= dt;
      if (cf.life <= 0 || cf.y > VH + 10) G.confetti.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 업데이트                                                            */
  /* ------------------------------------------------------------------ */
  function speedMultAt(t) { return clamp(1 + 1.2 * Math.pow(clamp(t, 0, 40) / 40, 0.85), 1, 2.2); }

  function computeMacro() {
    var c = G.clock;
    if (c < INTRO_END) { G.macro = 'INTRO'; return; }
    if (c < RACE_ROUNDS_END) {
      G.macro = 'RACE';
      var normalEnd = INTRO_END + NORMAL_ROUNDS * RLEN;
      var ri, rel, curLen;
      if (c < normalEnd) { ri = Math.floor((c - INTRO_END) / RLEN); rel = (c - INTRO_END) - ri * RLEN; curLen = RLEN; }
      else { ri = RC - 1; rel = c - normalEnd; curLen = LAST_RLEN; }
      G.rel = rel;
      if (ri !== G.roundIndex) setupRound(ri, curLen);
      var r = G.rel;
      G.sub = r < G.tSpawn ? 'SPAWN' : r < G.tApproach ? 'APPROACH' : r < G.tPick ? 'PICK' : r < G.tResolve ? 'RESOLVE' : 'CARRY';
      if (!G.round.resolved && r >= G.tPick) commitRound();
      return;
    }
    if (c < FINISH_END) { G.macro = 'FINISH'; return; }
    G.macro = 'CELEBRATION';
  }

  function update(dt) {
    if (!G.started) return;
    // 셰이크
    if (G.shakeT > 0) {
      G.shakeT -= dt;
      var k = Math.max(0, G.shakeT) * G.shakeMag;
      G.shakeX = rand(-1, 1) * G.shakeMag * (G.shakeT > 0 ? 1 : 0);
      G.shakeY = rand(-1, 1) * G.shakeMag * (G.shakeT > 0 ? 1 : 0);
      if (G.shakeT <= 0) { G.shakeX = 0; G.shakeY = 0; G.shakeMag = 0; }
    } else { G.shakeX = 0; G.shakeY = 0; }
    if (G.flash > 0) G.flash -= dt * 1.0;

    // 히트스톱: 시계는 흐르되 월드 모션만 잠깐 정지 느낌 → travel/anim만 감속
    var motionScale = 1;
    if (G.hitstop > 0) { G.hitstop -= dt; motionScale = 0.15; }

    G.clock += dt;
    computeMacro();

    // 남은 점심시간 긴박 연출(30초/10초 경고)
    var remain = Math.max(0, FINISH_END - G.clock);
    if (G.macro !== 'INTRO' && G.macro !== 'CELEBRATION') {
      if (!G.warnedT30 && remain <= 30) {
        G.warnedT30 = true;
        G.announce = { text: '점심시간 30초!', sub: '서둘러!', t: 0, color: '#ffd98a' };
        addShake(4, 0.25); G.flash = 0.06; G.flashColor = '#ffb26b'; Audio.sfx('beep'); Audio.sfx('whoosh');
      }
      if (!G.warnedT10 && remain <= 10) {
        G.warnedT10 = true;
        G.announce = { text: '점심시간 10초!', sub: '라스트 스퍼트!', t: 0, color: '#ff6b6b' };
        addShake(6, 0.3); G.flash = 0.09; G.flashColor = '#ff6b6b'; Audio.sfx('championUpgrade');
      }
    }
    if (G.announce) { G.announce.t += dt; if (G.announce.t > 1.9) G.announce = null; }
    if (G.bubble) { G.bubble.t += dt; if (G.bubble.t > 2.3) G.bubble = null; }

    // 함께 달리는 사람 말풍선 트리거(각 1회) — 1번째:콤보3, 3번째:등장, 5번째:등장
    if (G.macro === 'RACE') {
      if (!G.chaserBubShown.c0 && G.stats.combo >= 3 && G.champion && G.roundIndex >= 1) {
        G.chaserBubShown.c0 = true;
        G.chaserBub.push({ idx: 0, text: G.champion.name + '을 고르다니 맛잘알', t: 0 });
      }
      if (!G.chaserBubShown.c2 && G.roundIndex >= 3) {
        G.chaserBubShown.c2 = true;
        G.chaserBub.push({ idx: 2, text: '점심은 제육이 국룰이지', t: 0 });
      }
      if (!G.chaserBubShown.c4 && G.roundIndex >= 5) {
        G.chaserBubShown.c4 = true;
        G.chaserBub.push({ idx: 4, text: '너무 배고파', t: 0 });
      }
    }
    for (var cbi = G.chaserBub.length - 1; cbi >= 0; cbi--) {
      G.chaserBub[cbi].t += dt;
      if (G.chaserBub[cbi].t > 2.8) G.chaserBub.splice(cbi, 1);
    }

    // 속도/스크롤/러너 애니메이션 (시각 전용: 라운드 타이밍은 clock 기반이라 영향 없음)
    var baseV = (G.macro === 'INTRO') ? 0.35 : speedMultAt(G.clock);
    // baseV(시간 곡선) + pickBoost(선택마다 누적) + surge(선택 순간 순간 가속). 시각 연출이므로 넉넉히 캡.
    G.speedMult = Math.min(4.2, baseV + G.pickBoost + Math.max(0, G.surge) * 0.9);
    // 최종 배식장소(구내식당) 도착 직전부터 서서히 감속 — 마지막 라운드가 단축되며 확보된 시간을
    // 전부 이 감속 연출에 사용한다. RACE_ROUNDS_END(마지막 라운드 종료)부터 FINISH_END(완주)까지
    // 서서히 걷는 속도(0.4배)까지 떨어진다.
    if (G.clock >= RACE_ROUNDS_END) {
      var arriveT = clamp((G.clock - RACE_ROUNDS_END) / (FINISH_END - RACE_ROUNDS_END), 0, 1);
      G.speedMult = lerp(G.speedMult, 0.4, easeInOutCubic(arriveT));
    }
    if (G.surge > 0) G.surge -= dt * 2.2;   // 서지 ~0.45s 감쇠
    G.travel += 9 * G.speedMult * dt * motionScale;

    // 러너 레인 이징
    var tx = laneX(PLAYER_Y, G.runner.targetLane);
    G.runner.lean = clamp((tx - G.runner.x) * 0.12, -3, 3);
    G.runner.x += (tx - G.runner.x) * 0.22;
    // 런 사이클
    var cadence = (G.macro === 'INTRO' ? 1.6 : 2.4 * G.speedMult);
    G.runner.phase = (G.runner.phase + dt * cadence * motionScale) % 1;
    var frame = Math.floor(G.runner.phase * 4) % 4;
    if ((frame === 0 || frame === 2) && frame !== G.runner.lastFrame && G.macro !== 'INTRO') {
      // 발디딤 먼지 + 소리
      G.dust.push({ x: G.runner.x + (frame === 0 ? -3 : 3), y: PLAYER_Y, n: 3 });
      if (Math.random() < 0.6) Audio.sfx('footstep');
    }
    G.runner.lastFrame = frame;

    // 카운트다운/GO 사운드 (INTRO)
    if (G.macro === 'INTRO') {
      var beats = [[1.6, 'beep'], [2.2, 'beep'], [2.6, 'beep']];
      for (var bI = 0; bI < beats.length; bI++) {
        if (!G['_beep' + bI] && G.clock >= beats[bI][0]) { G['_beep' + bI] = true; Audio.sfx(beats[bI][1]); }
      }
    }
    if (!G.goFired && G.clock >= INTRO_END) {
      G.goFired = true; Audio.sfx('go'); G.flash = 0.08; G.flashColor = '#ffffff'; addShake(4, 0.16);
      spawnParticles(G.runner.x, PLAYER_Y - 6, 14, ['#f5f5ef', '#ffe14d']);
    }

    // 카드 approach 사운드
    if (G.macro === 'RACE' && G.sub === 'APPROACH' && !G.round._approachSfx && G.rel > G.tSpawn + (G.tApproach - G.tSpawn) * 0.55) {
      G.round._approachSfx = true; Audio.sfx('cardApproach');
    }
    if (G.macro === 'RACE' && G.sub === 'SPAWN') G.round._approachSfx = false;

    // FINISH: 완주 플래시
    if (G.macro === 'FINISH' && !G.finishFlashed && G.clock >= FINISH_END - 0.02) {
      // 곧 셀레브레이션
    }

    // 복도 소품 스폰(z-list): 화분4종·창문·문·액자·의자를 좌우 번갈아, 넉넉한 간격으로
    var PROP_CYCLE = [
      { t: 'pillar' }, { t: 'coworker', v: 0 }, { t: 'window' }, { t: 'plant', v: 0 },
      { t: 'coworker', v: 1 }, { t: 'exit' }, { t: 'pillar' }, { t: 'plant', v: 2 },
      { t: 'coworker', v: 2 }, { t: 'window' }, { t: 'frame' }, { t: 'plant', v: 1 },
      { t: 'coworker', v: 3 }, { t: 'door' }, { t: 'pillar' }, { t: 'chair' },
      { t: 'plant', v: 3 }, { t: 'window' }, { t: 'coworker', v: 0 }, { t: 'exit' }
    ];
    G.lampSpawn -= dt;
    if (G.lampSpawn <= 0 && G.macro !== 'CELEBRATION') {
      G.lampSpawn = 0.62;   // 배경 오브젝트 등장 빈도 증가(기존 1.0s -> 0.62s 간격)
      var pc = PROP_CYCLE[G.spawnSeq % PROP_CYCLE.length];
      // 사람(동료) 오브젝트 중 딱 한 번만 "이분 완전 맛잘알" 말풍선 노출
      var showBubble = (pc.t === 'coworker' && !G.coworkerBubbleShown && G.macro === 'RACE');
      if (showBubble) G.coworkerBubbleShown = true;
      G.lamps.push({ z: 1500, side: (G.spawnSeq % 2 === 0) ? -1 : 1, type: pc.t, variant: pc.v || 0, bubble: showBubble });
      G.spawnSeq++;
    }
    // 소품 접근 속도: 속도배율에 완만하게 연동(급가속 완화)
    var propSpeed = 150 * (0.55 + 0.45 * G.speedMult);
    for (var li = G.lamps.length - 1; li >= 0; li--) {
      G.lamps[li].z -= propSpeed * dt * motionScale;
      if (G.lamps[li].z < 18) G.lamps.splice(li, 1);
    }

    // 토스트
    if (G.toast) { G.toast.t += dt; if (G.toast.t > 1.0) G.toast = null; }
    // 선택 카드 펀치/링
    var cards = G.round.cards;
    for (var ci = 0; ci < cards.length; ci++) {
      if (cards[ci].chosen) { cards[ci].punchT += dt; if (cards[ci].ring != null) cards[ci].ring += dt; }
    }

    // 셀레브레이션 진입
    if (G.macro === 'CELEBRATION' && !G.celebFired) {
      G.celebFired = true;
      Audio.stopBgm();
      G.finalWinner = G.champion || (CFG.FOODS[0]);
      G.winnerLine = WINNER_LINES[randi(0, WINNER_LINES.length - 1)].replace('{menu}', G.finalWinner.name);
      Audio.sfx('finishLine');
      setTimeout(function () { Audio.sfx('winnerFanfare'); }, 400);
      spawnConfetti(60); G.celebConfettiT = 0;
      addShake(6, 0.25); G.flash = 0.09; G.flashColor = '#ffffff';
      // 명예의 전당에 이번 우승 메뉴 집계 반영 후, 서버 처리 시간을 살짝 기다렸다가 최신 순위 재조회
      reportWin(G.finalWinner.slug);
      setTimeout(fetchHOF, 350);
    }
    if (G.macro === 'CELEBRATION') {
      G.celebConfettiT += dt;
      if (G.celebConfettiT > 0.9 && G.confetti.length < 40) { spawnConfetti(24); Audio.sfx('confetti'); G.celebConfettiT = 0; }
      // 우승 메뉴명 타이핑
      var target = G.finalWinner ? G.finalWinner.name.length : 0;
      if (G.clock - FINISH_END > 0.6) G.typeChars = Math.min(target, G.typeChars + dt * 14);
    }

    updateParticles(dt);
    // dust → 파티클 변환
    for (var di = G.dust.length - 1; di >= 0; di--) {
      var du = G.dust[di];
      for (var k2 = 0; k2 < du.n; k2++)
        G.particles.push({ x: du.x + rand(-2, 2), y: du.y, vx: rand(-15, 15), vy: rand(-25, -5),
          life: 0.3, max: 0.3, size: 1, color: '#b0ab9a' });
      G.dust.splice(di, 1);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 렌더: 배경 / 도로 / 러너 / 카드 / 이펙트                            */
  /* ------------------------------------------------------------------ */
  function progress() { return clamp(G.clock / FINISH_END, 0, 1); }

  function px(x, y, w, h, col) { bctx.fillStyle = col; bctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

  // 오피스 복도 색 (office.jpg 참고: 흰 천장/우드 패널/검정 프레임 유리문/밝은 회색 바닥)
  var C_CEIL = '#edece6', C_CEIL_HI = '#fffdf2', C_WALL = '#dfdbd0', C_WALL_HI = '#eae6db',
      C_WALL_LO = '#b6b1a4', C_WOOD = '#b78a52', C_WOOD_LO = '#7a4a2a', C_GLASS = '#9db9d0',
      C_FRAME = '#2b2b33', C_FLOOR1 = '#d8d3c7', C_FLOOR2 = '#cbc6ba';

  function line2(ax, ay, bx, by) { bctx.beginPath(); bctx.moveTo(ax, ay); bctx.lineTo(bx, by); bctx.stroke(); }

  function drawCorridorBg() {
    // 0) 전체를 벽 색으로 베이스 채움 → 바닥/천장 곡선과 삼각형 사이 '빈 공간' 노출 방지
    px(0, 0, VW, VH, C_WALL);
    // 벽 근/원경 음영: 위쪽(원경)일수록 살짝 어둡게 세로 그라디언트 근사
    bctx.fillStyle = C_WALL_LO;
    for (var g = 0; g < 8; g++) { bctx.globalAlpha = 0.05 * (8 - g) / 8 * 8 / 8; px(0, HORIZON_Y + g * 3, VW, 3, C_WALL_LO); }
    bctx.globalAlpha = 1;
    // 우드 걸레받이(벽 하단, 소실점 방향 대각)
    bctx.strokeStyle = C_WOOD; bctx.lineWidth = 1; bctx.globalAlpha = 0.55;
    line2(0, VH - 24, VPX, HORIZON_Y + 5); line2(VW, VH - 24, VPX, HORIZON_Y + 5);
    bctx.globalAlpha = 1;
    // 천장 (삼각형)
    bctx.fillStyle = C_CEIL;
    bctx.beginPath(); bctx.moveTo(0, 0); bctx.lineTo(VW, 0); bctx.lineTo(VPX, HORIZON_Y); bctx.closePath(); bctx.fill();
    // 천장 라인조명(소실점 수렴) + 글로우
    var strips = [-56, -20, 20, 56];
    bctx.strokeStyle = C_CEIL_HI; bctx.globalAlpha = 0.28; bctx.lineWidth = 3;
    for (var i = 0; i < strips.length; i++) line2(VPX + strips[i], 0, VPX, HORIZON_Y);
    bctx.globalAlpha = 1; bctx.lineWidth = 1;
    for (i = 0; i < strips.length; i++) line2(VPX + strips[i], 0, VPX, HORIZON_Y);
    // 코너 원근선(천장/벽 경계)
    bctx.strokeStyle = C_WALL_LO; bctx.lineWidth = 1;
    line2(0, 0, VPX, HORIZON_Y); line2(VW, 0, VPX, HORIZON_Y);
  }

  function drawFarWall() {
    // 복도 끝 벽 + WemadePlay 로고 (항상 배경에 노출)
    var w = 60, h = 34, x = Math.round(VPX - w / 2), y = HORIZON_Y - h + 6;
    px(x - 2, y - 2, w + 4, h + 4, C_WOOD_LO);
    px(x, y, w, h, C_WALL_HI);
    px(x, y, w, 1, '#ffffff'); px(x, y + h - 1, w, 1, C_WALL_LO);
    if (LOGO.img) {
      var lw = w - 10, lh = lw * LOGO.img.height / LOGO.img.width;
      if (lh > h - 12) { lh = h - 12; lw = lh * LOGO.img.width / LOGO.img.height; }
      // 로고는 버퍼(4배 도트화)가 아니라 디스플레이에 원본 그대로 크리스프 렌더
      OVERLAY.push({ face: LOGO.img, bx: VPX - lw / 2, by: y + (h - lh) / 2, bw: lw, bh: lh });
    } else {
      OVERLAY.push({ text: 'WEMADE PLAY', bx: VPX, by: y + h / 2, size: 4.5, color: '#241b2f', shadow: false });
    }
  }

  function drawRoad() {   // 복도 바닥(밝은 회색 폴리시 타일)
    for (var y = HORIZON_Y; y < VH; y++) {
      var hw = roadHalfWidth(y);
      var phase = depthZ(y) * 0.09 + G.travel;
      var band = Math.floor(phase) & 1;
      px(VPX - hw, y, hw * 2, 1, band ? C_FLOOR1 : C_FLOOR2);
      // 폴리시 반사 하이라이트(중앙 세로 대역)
      if ((Math.floor(phase) % 5) === 0) { bctx.globalAlpha = 0.1; px(VPX - hw * 0.35, y, hw * 0.7, 1, '#ffffff'); bctx.globalAlpha = 1; }
      // 걸레받이(바닥-벽 경계)
      px(VPX - hw - 1, y, 2, 1, C_WOOD_LO); px(VPX + hw - 1, y, 2, 1, C_WOOD_LO);
      // 레인 가이드(은은한 점선)
      if (band === 0) {
        var d = hw * 0.31;
        bctx.globalAlpha = 0.45;
        px(VPX - d, y, 1, 1, '#a8a294'); px(VPX + d - 1, y, 1, 1, '#a8a294');
        bctx.globalAlpha = 1;
      }
    }
    // 목표 레인 바닥 글로우
    if (G.macro === 'RACE' && subAllowsInput()) {
      var L = G.runner.targetLane;
      bctx.globalAlpha = 0.22 + 0.07 * Math.sin(G.clock * 8);
      bctx.fillStyle = '#ffe14d';
      for (var yy = GATE_Y - 8; yy < PLAYER_Y + 4; yy++) {
        var w = roadHalfWidth(yy) * 0.5;
        bctx.fillRect(Math.round(laneX(yy, L) - w / 2), yy, Math.round(w), 1);
      }
      bctx.globalAlpha = 1;
    }
  }

  /* --- 벽 원근 헬퍼: 벽 사선을 따르는 사다리꼴(quad) --- */
  function _lp(p, q, t) { return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; }
  function _quad(a, b, c, d, col) {
    bctx.fillStyle = col; bctx.beginPath();
    bctx.moveTo(a[0], a[1]); bctx.lineTo(b[0], b[1]); bctx.lineTo(c[0], c[1]); bctx.lineTo(d[0], d[1]);
    bctx.closePath(); bctx.fill();
  }
  function _inset(c, m) {   // 4모서리를 중심으로 m만큼 안쪽으로
    var cx = (c.bF[0] + c.bB[0] + c.tF[0] + c.tB[0]) / 4, cy = (c.bF[1] + c.bB[1] + c.tF[1] + c.tB[1]) / 4;
    return { bF: _lp(c.bF, [cx, cy], m), bB: _lp(c.bB, [cx, cy], m), tF: _lp(c.tF, [cx, cy], m), tB: _lp(c.tB, [cx, cy], m) };
  }
  // 벽면 패널의 4모서리(앞=z 가까움/큼, 뒤=z+깊이 멀음/작음). bottomH~topH = 바닥 위 높이(월드).
  function _wallCorners(dir, z, depthW, bottomH, topH) {
    var zF = z, zB = z + depthW;
    var yF = HORIZON_Y - 2 + 2400 / zF, yB = HORIZON_Y - 2 + 2400 / zB;
    var xF = VPX + dir * roadHalfWidth(yF), xB = VPX + dir * roadHalfWidth(yB);
    var sF = 60 / zF, sB = 60 / zB;
    return {
      bF: [xF, yF - bottomH * sF], bB: [xB, yB - bottomH * sB],
      tF: [xF, yF - topH * sF], tB: [xB, yB - topH * sB], sF: sF, sB: sB,
    };
  }

  function drawProps() {   // 복도 소품: 벽 부착(문·창·액자)은 사선 원근 quad, 화분·의자는 스케일 빌보드
    var arr = G.lamps.slice().sort(function (a, b) { return b.z - a.z; }); // 원경부터
    for (var i = 0; i < arr.length; i++) {
      var lp = arr[i];
      var yF = HORIZON_Y - 2 + 2400 / lp.z;
      if (yF < HORIZON_Y + 2 || yF > VH + 120) continue;   // 화면 밖 컬
      if (lp.type === 'frame') drawPropFrame(lp.z, lp.side);
      else if (lp.type === 'plant') drawPropPlant(lp.z, lp.side, lp.variant);
      else if (lp.type === 'window') drawPropWindow(lp.z, lp.side);
      else if (lp.type === 'chair') drawPropChair(lp.z, lp.side);
      else if (lp.type === 'exit') drawPropExit(lp.z, lp.side);
      else if (lp.type === 'pillar') drawPropPillar(lp.z, lp.side);
      else if (lp.type === 'coworker') drawPropCoworker(lp.z, lp.side, lp.variant, lp.bubble);
      else drawPropDoor(lp.z, lp.side);
    }
  }
  function drawPropDoor(z, dir) {   // 우드프레임 유리문 — 벽 사선 정렬
    var c = _wallCorners(dir, z, z * 0.30, 0, 40);
    _quad(c.bF, c.bB, c.tB, c.tF, C_WOOD);                       // 우드 프레임
    var cf = _inset(c, 0.16); _quad(cf.bF, cf.bB, cf.tB, cf.tF, C_FRAME);   // 검정 프레임
    var cg = _inset(c, 0.28); _quad(cg.bF, cg.bB, cg.tB, cg.tF, C_GLASS);   // 유리
    // 앞쪽 세로 반사
    bctx.globalAlpha = 0.3;
    _quad(cg.bF, _lp(cg.bF, cg.bB, 0.16), _lp(cg.tF, cg.tB, 0.16), cg.tF, '#ffffff');
    bctx.globalAlpha = 1;
  }
  function drawPropFrame(z, dir) {   // 벽에 걸린 액자(눈높이 위) — 벽 사선 정렬
    var c = _wallCorners(dir, z, z * 0.26, 20, 32);
    _quad(c.bF, c.bB, c.tB, c.tF, C_WOOD);
    var g = _inset(c, 0.18);
    var mF = _lp(g.bF, g.tF, 0.55), mB = _lp(g.bB, g.tB, 0.55);
    _quad(mF, mB, g.tB, g.tF, '#7fd4ff');    // 하늘
    _quad(g.bF, g.bB, mB, mF, '#3fae6b');    // 언덕
  }
  function drawPropWindow(z, dir) {   // 벽에 걸린 넓은 창문 — 벽 사선 정렬
    var c = _wallCorners(dir, z, z * 0.44, 12, 34);
    _quad(c.bF, c.bB, c.tB, c.tF, '#e8e4da');           // 창틀
    var g = _inset(c, 0.12);
    var mF = _lp(g.bF, g.tF, 0.52), mB = _lp(g.bB, g.tB, 0.52);
    _quad(mF, mB, g.tB, g.tF, '#7fd4ff');               // 상단 하늘
    _quad(g.bF, g.bB, mB, mF, '#b9a9c9');               // 하단 원경 지면
    // 십자 창살
    var vbF = _lp(g.bF, g.bB, 0.47), vbB = _lp(g.bF, g.bB, 0.53), vtF = _lp(g.tF, g.tB, 0.47), vtB = _lp(g.tF, g.tB, 0.53);
    _quad(vbF, vbB, vtB, vtF, '#e8e4da');
    var hlF = _lp(g.bF, g.tF, 0.47), hlB = _lp(g.bB, g.tB, 0.47), hhF = _lp(g.bF, g.tF, 0.53), hhB = _lp(g.bB, g.tB, 0.53);
    _quad(hlF, hlB, hhB, hhF, '#e8e4da');
  }
  function drawPropPlant(z, dir, v) {   // 바닥 화분 4종 (자유서 있는 물체 → 스케일 빌보드)
    var y = HORIZON_Y - 2 + 2400 / z, s = clamp(60 / z, 0.05, 3.0), edge = VPX + dir * roadHalfWidth(y);
    v = v || 0;
    var potW, potH, potCol, potHi;
    if (v === 1) { potW = 9 * s; potH = 8 * s; potCol = '#e8e4da'; potHi = '#ffffff'; }      // 흰 도자기
    else if (v === 2) { potW = 6 * s; potH = 6 * s; potCol = '#46394f'; potHi = '#7b6d8d'; } // 진회색
    else if (v === 3) { potW = 8 * s; potH = 6 * s; potCol = '#2e4a8f'; potHi = '#5a7fd6'; } // 블루 세라믹
    else { potW = 8 * s; potH = 6 * s; potCol = '#b06a3a'; potHi = '#c98a5a'; }              // 테라코타
    var x0 = dir < 0 ? edge - potW - 1 * s : edge + 1 * s, pty = y - potH;
    if (v === 1) {                     // 야자수/파키라 (키 큰 잎)
      var tx = x0 + potW / 2;
      px(tx - 0.5 * s, pty - 18 * s, Math.max(1, s), 18 * s, '#7a4a2a');   // 줄기
      px(tx - 8 * s, pty - 19 * s, 8 * s, 2 * s, '#1f7a4d'); px(tx, pty - 19 * s, 8 * s, 2 * s, '#1f7a4d');
      px(tx - 6 * s, pty - 22 * s, 6 * s, 2 * s, '#3fae6b'); px(tx + 1 * s, pty - 22 * s, 6 * s, 2 * s, '#3fae6b');
      px(tx - 1.5 * s, pty - 25 * s, 3 * s, 4 * s, '#3fae6b');
    } else if (v === 2) {              // 선인장
      var cx0 = x0 + potW / 2 - 1.5 * s;
      px(cx0, pty - 15 * s, 3 * s, 15 * s, '#3fae6b');                     // 몸통
      px(cx0 - 3 * s, pty - 10 * s, 3 * s, 2 * s, '#3fae6b'); px(cx0 - 3 * s, pty - 12 * s, 2 * s, 3 * s, '#3fae6b'); // 왼팔
      px(cx0 + 3 * s, pty - 12 * s, 3 * s, 2 * s, '#3fae6b'); px(cx0 + 4 * s, pty - 15 * s, 2 * s, 4 * s, '#3fae6b'); // 오른팔
      px(cx0 + 0.5 * s, pty - 17 * s, 2 * s, 2 * s, '#ff6b6b');            // 꽃
    } else if (v === 3) {             // 꽃 화분
      px(x0 - 1 * s, pty - 9 * s, potW + 2 * s, 9 * s, '#1f7a4d');
      px(x0 + 1 * s, pty - 12 * s, potW - 2 * s, 4 * s, '#3fae6b');
      px(x0 + 1 * s, pty - 11 * s, 2 * s, 2 * s, '#ff6b6b');
      px(x0 + potW - 3 * s, pty - 10 * s, 2 * s, 2 * s, '#ffe14d');
      px(x0 + potW / 2 - 1 * s, pty - 13 * s, 2 * s, 2 * s, '#ff6b6b');
    } else {                          // 관엽(둥근 잎)
      px(x0 - 1 * s, pty - 9 * s, potW + 2 * s, 9 * s, '#1f7a4d');
      px(x0 + 1 * s, pty - 12 * s, potW - 2 * s, 5 * s, '#3fae6b');
      px(x0 + 2 * s, pty - 13 * s, potW - 4 * s, 2 * s, '#3fae6b');
    }
    px(x0, pty, potW, potH, potCol); px(x0, pty, potW, 1, potHi);
    px(x0, pty + potH - 1, potW, 1, 'rgba(13,11,26,0.3)');
  }
  function drawPropChair(z, dir) {   // 바닥 의자 (자유서 있는 물체 → 스케일 빌보드)
    var y = HORIZON_Y - 2 + 2400 / z, s = clamp(60 / z, 0.05, 3.0), edge = VPX + dir * roadHalfWidth(y);
    var w = 9 * s, h = 12 * s, x0 = dir < 0 ? edge - w - 1 * s : edge + 1 * s, top = y - h;
    var col = '#46394f';
    px(x0 + (dir < 0 ? w - 2 * s : 0), top, 2 * s, h, col);        // 등받이
    px(x0, top + h * 0.5, w, 2 * s, col);                          // 좌석
    px(x0 + 1 * s, top + h * 0.62, 1 * s, h * 0.38, '#241b2f');    // 다리
    px(x0 + w - 2 * s, top + h * 0.62, 1 * s, h * 0.38, '#241b2f');
  }
  function drawPropExit(z, dir) {   // 출입문(사무실 정문) — 벽 사선 정렬, 넓고 높음 + 초록 사인
    var c = _wallCorners(dir, z, z * 0.36, 0, 48);
    _quad(c.bF, c.bB, c.tB, c.tF, C_WOOD_LO);                    // 짙은 우드 프레임
    var g = _inset(c, 0.10);
    // 상단 초록 사인 바(출입구 표시)
    var sF = _lp(g.bF, g.tF, 0.82), sB = _lp(g.bB, g.tB, 0.82);
    _quad(sF, sB, g.tB, g.tF, '#3fae6b');                        // 초록 사인
    // 좌우 유리 두 짝
    var dF = _lp(g.bF, g.tF, 0.80), dB = _lp(g.bB, g.tB, 0.80);  // 사인 아래
    var mB0 = _lp(dF, dB, 0.5), mBt = _lp(g.bF, g.bB, 0.5);
    _quad(g.bF, mBt, mB0, dF, '#9db9d0');                        // 왼짝 유리
    _quad(mBt, g.bB, dB, mB0, '#8fb0c8');                        // 오른짝 유리
    // 가운데 세로 기둥
    var vb = _lp(g.bF, g.bB, 0.48), vb2 = _lp(g.bF, g.bB, 0.52), vt = _lp(dF, dB, 0.48), vt2 = _lp(dF, dB, 0.52);
    _quad(vb, vb2, vt2, vt, C_WOOD_LO);
  }
  function drawPropPillar(z, dir) {   // 기둥(구조 컬럼) — 바닥~천장, 원통 음영 빌보드
    var y = HORIZON_Y - 2 + 2400 / z, s = clamp(60 / z, 0.05, 3.0);
    var edge = VPX + dir * roadHalfWidth(y);
    var w = 8 * s, x0 = dir < 0 ? edge - w : edge;
    var topY = Math.max(HORIZON_Y - 2, y - 62 * s);              // 위로 길게(천장 방향)
    // 기둥 몸통 (좌 그림자 / 중 밝음 / 우 중간 → 원통감)
    px(x0, topY, w, y - topY, '#c9c5ba');
    px(x0, topY, w * 0.28, y - topY, '#b0ab9a');                 // 좌측 음영
    px(x0 + w * 0.34, topY, w * 0.30, y - topY, '#eae6db');      // 중앙 하이라이트
    px(x0, topY, w, 1, '#f5f5ef');
    // 기둥 머리(주두)/받침
    px(x0 - 1 * s, topY, w + 2 * s, 3 * s, '#d9d5c8');
    px(x0 - 1 * s, y - 3 * s, w + 2 * s, 3 * s, '#b0ab9a');
  }
  function drawPropCoworker(z, dir, v, bubble) {   // 직장 동료 4종 — 벽 옆에 서 있는 빌보드
    var y = HORIZON_Y - 2 + 2400 / z, s = clamp(60 / z, 0.05, 3.0);
    var edge = VPX + dir * roadHalfWidth(y);
    // 벽에서 살짝 안쪽(통로 가장자리)에 서 있게
    var x0 = edge + dir * (-4 * s) - (dir < 0 ? 8 * s : 0);
    var cxp = x0 + 4 * s;
    var pal = [
      { hair: '#3a2a1a', shirt: '#5a7fd6', low: '#241b2f', tie: '#ff6b6b' }, // 남 파란셔츠
      { hair: '#241b2f', shirt: '#ff9ab0', low: '#7b6d8d', tie: null },      // 여 분홍블라우스(긴머리)
      { hair: '#7a4a2a', shirt: '#f5f5ef', low: '#46394f', tie: '#d43d3d' }, // 남 흰셔츠 넥타이
      { hair: '#0d0b1a', shirt: '#ffe14d', low: '#2e4a8f', tie: null },      // 여 노랑가디건 청바지
    ][v || 0];
    var top = y - 20 * s;
    // 그림자
    bctx.globalAlpha = 0.35; bctx.fillStyle = '#241b2f';
    bctx.beginPath(); bctx.ellipse(cxp, y, 5 * s, 1.8 * s, 0, 0, Math.PI * 2); bctx.fill(); bctx.globalAlpha = 1;
    // 다리/하의
    px(cxp - 3 * s, top + 12 * s, 6 * s, 8 * s, pal.low);
    px(cxp - 3 * s, y - 2 * s, 2.5 * s, 2 * s, '#241b2f'); px(cxp + 0.5 * s, y - 2 * s, 2.5 * s, 2 * s, '#241b2f');
    // 상의
    px(cxp - 4 * s, top + 4 * s, 8 * s, 9 * s, '#0d0b1a');       // 아웃라인
    px(cxp - 3 * s, top + 4 * s, 6 * s, 8 * s, pal.shirt);
    if (pal.tie) px(cxp - 0.5 * s, top + 5 * s, 1.5 * s, 5 * s, pal.tie);
    // 팔
    px(cxp - 5 * s, top + 5 * s, 2 * s, 6 * s, pal.shirt); px(cxp + 3 * s, top + 5 * s, 2 * s, 6 * s, pal.shirt);
    // 머리
    px(cxp - 3 * s, top - 3 * s, 6 * s, 6 * s, '#f0c39a');       // 얼굴
    px(cxp - 3 * s, top - 4 * s, 6 * s, 3 * s, pal.hair);        // 머리
    if (v === 1 || v === 3) px(cxp - 4 * s, top - 3 * s, 8 * s, 5 * s, pal.hair), px(cxp - 3 * s, top - 1 * s, 6 * s, 4 * s, '#f0c39a'); // 긴머리
    // 눈(정면)
    px(cxp - 2 * s, top - 1 * s, 1 * s, 1 * s, '#241b2f'); px(cxp + 1 * s, top - 1 * s, 1 * s, 1 * s, '#241b2f');

    // 전체 동료 중 단 한 명에게만 노출되는 말풍선("이분 완전 맛잘알") — 충분히 커졌을 때만 표시
    if (bubble && s > 0.55) {
      OVERLAY.push({ bubble: true, text: '이분 완전 맛잘알', bx: cxp, by: top - 6 * s, size: 6 });
    }
  }

  // 라운드마다 1명씩 늘어나는 함께 달리는 무리. 주인공(중앙 전방)보다 '뒤쪽(작은 y)'의
  // 1·2·3 레인 안쪽에 여러 줄로 배치. 트랙에 고정(플레이어를 따라 움직이지 않음)되고 제자리 달리기.
  // x는 그리는 시점에 laneX(fy, lane) 로 계산(레인 정중앙 정렬). 카드는 이보다 앞(나중)에 그려 안 가림.
  // 말풍선 대상 인덱스(0=1번째, 2=3번째, 4=5번째)는 잘 보이도록 측면 레인에 둔다.
  var CHASER_SLOTS = [
    { lane: 0, fy: 146, s: 2.0 },   // 1번째(좌) — 콤보3 말풍선
    { lane: 2, fy: 146, s: 2.0 },   // 2번째(우)
    { lane: 2, fy: 140, s: 1.72 },  // 3번째(우) — 등장 말풍선
    { lane: 0, fy: 140, s: 1.72 },  // 4번째(좌)
    { lane: 0, fy: 134, s: 1.5 },   // 5번째(좌) — 등장 말풍선
    { lane: 2, fy: 134, s: 1.5 },   // 6번째(우)
    { lane: 1, fy: 138, s: 1.62 },  // 7번째(중앙, 뒤)
    { lane: 1, fy: 131, s: 1.42 },  // 8번째(중앙, 더 뒤)
  ];
  var CHASER_PAL = [
    { hair: '#3a2a1a', shirt: '#5a7fd6', low: '#241b2f', tie: '#ff6b6b' },
    { hair: '#241b2f', shirt: '#ff9ab0', low: '#7b6d8d', tie: null },
    { hair: '#7a4a2a', shirt: '#f5f5ef', low: '#46394f', tie: '#d43d3d' },
    { hair: '#0d0b1a', shirt: '#ffe14d', low: '#2e4a8f', tie: null },
    { hair: '#46394f', shirt: '#3fae6b', low: '#241b2f', tie: null },
  ];
  function drawChaserPerson(cx, fy0, s, pal, phase) {
    var frame = Math.floor(phase * 4) % 4;   // 4프레임 달리기
    var bob = -Math.abs(Math.sin(phase * Math.PI * 2)) * 1.4 * s;
    var y = fy0 + bob, top = y - 13 * s;
    // 그림자(제자리 고정 — 발 위치는 안 움직임)
    bctx.globalAlpha = 0.3; bctx.fillStyle = '#241b2f';
    bctx.beginPath(); bctx.ellipse(cx, fy0, 4 * s, 1.4 * s, 0, 0, Math.PI * 2); bctx.fill(); bctx.globalAlpha = 1;
    // 다리(달리는 모션)
    var lift = (frame === 0) ? [-1.3, 0] : (frame === 2) ? [0, -1.3] : [-0.6, -0.6];
    px(cx - 2.4 * s, y - 5 * s + lift[0] * s, 1.9 * s, 5 * s, pal.low);
    px(cx + 0.5 * s, y - 5 * s + lift[1] * s, 1.9 * s, 5 * s, pal.low);
    px(cx - 2.6 * s, y - 1 * s, 2.3 * s, 1.5 * s, '#241b2f');
    px(cx + 0.5 * s, y - 1 * s, 2.3 * s, 1.5 * s, '#241b2f');
    // 몸통
    px(cx - 3.2 * s, top + 4 * s, 6.4 * s, 6 * s, '#0d0b1a');       // 아웃라인
    px(cx - 2.6 * s, top + 4 * s, 5.2 * s, 5 * s, pal.shirt);
    if (pal.tie) px(cx - 0.5 * s, top + 4.5 * s, 1 * s, 4 * s, pal.tie);
    // 팔(스윙)
    var arm = (frame === 0) ? [1, -1] : (frame === 2) ? [-1, 1] : [0, 0];
    px(cx - 3.8 * s, top + 5 * s + arm[0] * s, 1.4 * s, 4.5 * s, pal.shirt);
    px(cx + 2.4 * s, top + 5 * s + arm[1] * s, 1.4 * s, 4.5 * s, pal.shirt);
    // 머리
    px(cx - 2.4 * s, top - 0.5 * s, 4.8 * s, 4.8 * s, '#f0c39a');
    px(cx - 2.4 * s, top - 1 * s, 4.8 * s, 2.8 * s, pal.hair);
  }
  function chaserBubbleFor(idx) {
    for (var i = 0; i < G.chaserBub.length; i++) if (G.chaserBub[i].idx === idx) return G.chaserBub[i];
    return null;
  }
  function drawChasers() {
    if (G.macro === 'CELEBRATION') return;
    var n = Math.min(CHASER_SLOTS.length, Math.max(0, G.roundIndex));
    if (n <= 0) return;
    var order = [];
    for (var i = 0; i < n; i++) order.push(i);
    order.sort(function (a, b) { return CHASER_SLOTS[a].fy - CHASER_SLOTS[b].fy; }); // 뒤(위)부터 그려 근경이 앞에
    for (var k = 0; k < order.length; k++) {
      var idx = order[k], o = CHASER_SLOTS[idx];
      var x = laneX(o.fy, o.lane);
      var phase = (G.runner.phase + idx * 0.31) % 1;   // 각자 다른 발 타이밍
      drawChaserPerson(x, o.fy, o.s, CHASER_PAL[idx % CHASER_PAL.length], phase);
      var bub = chaserBubbleFor(idx);
      if (bub) {
        var ba = bub.t < 0.15 ? bub.t / 0.15 : (bub.t > 2.3 ? 1 - (bub.t - 2.3) / 0.5 : 1);
        // 좌 레인은 왼쪽으로, 우 레인은 오른쪽으로 말풍선을 뻗어 중앙 플레이어 말풍선과 안 겹치게
        var bias = o.lane === 0 ? -1 : o.lane === 2 ? 1 : 0;
        OVERLAY.push({ bubble: true, text: bub.text, bx: x, by: o.fy - 13 * o.s - 9, size: 5.5, alpha: clamp(ba, 0, 1), bias: bias });
      }
    }
  }

  function drawRunner() {
    var frame = Math.floor(G.runner.phase * 4) % 4;
    var bobAmp = 2 + clamp((G.speedMult - 1) * 0.5, 0, 2);   // 빠를수록 상하 흔들림 커짐
    var bob = -Math.abs(Math.sin(G.runner.phase * Math.PI * 2)) * bobAmp;
    if (G.macro === 'INTRO') bob = -Math.abs(Math.sin(G.clock * 4)) * 1.5;
    var cx = Math.round(G.runner.x + G.runner.lean);
    var footY = Math.round(PLAYER_Y + bob);
    var top = footY - 22;
    var RS = 1.4;   // 캐릭터 확대 배율

    // 질주 연출: 좌우 윈드 스트릭 (속도가 빠를수록 길고 진하게)
    var sp = clamp((G.speedMult - 1) / 2.2, 0, 1);
    if (sp > 0.05 && G.macro !== 'INTRO') {
      bctx.strokeStyle = '#ffffff'; bctx.lineWidth = 1;
      for (var li = 0; li < 5; li++) {
        if ((Math.floor(G.travel * 9 + li * 2) % 3) === 0) continue;  // 깜빡임
        var yy = footY - 3 - li * 5;
        var len = 5 + 13 * sp + (li % 2) * 3;
        var gap = 12;
        bctx.globalAlpha = 0.18 + 0.5 * sp;
        bctx.beginPath(); bctx.moveTo(cx - gap - len, yy); bctx.lineTo(cx - gap, yy); bctx.stroke();
        bctx.beginPath(); bctx.moveTo(cx + gap, yy); bctx.lineTo(cx + gap + len, yy); bctx.stroke();
      }
      bctx.globalAlpha = 1;
    }

    // 그림자 (확대)
    bctx.globalAlpha = 0.4; bctx.fillStyle = '#241b2f';
    bctx.beginPath(); bctx.ellipse(Math.round(G.runner.x - G.runner.lean * 0.5), PLAYER_Y + 1, 7 * RS, 2.6 * RS, 0, 0, Math.PI * 2); bctx.fill();
    bctx.globalAlpha = 1;

    // 본체: 발(footY)을 피벗으로 RS배 확대
    bctx.save();
    bctx.translate(cx, footY); bctx.scale(RS, RS); bctx.translate(-cx, -footY);

    var O = '#0d0b1a';
    // 다리(프레임별)
    var lift = (frame === 0) ? [-3, 0] : (frame === 2) ? [0, -3] : [-1, -1];
    // 왼다리
    px(cx - 4, footY - 7 + lift[0], 3, 7, '#46394f'); px(cx - 4, footY - 1 + lift[0], 4, 2, '#241b2f');
    // 오른다리
    px(cx + 1, footY - 7 + lift[1], 3, 7, '#46394f'); px(cx + 1, footY - 1 + lift[1], 4, 2, '#241b2f');
    // 몸통(셔츠)
    px(cx - 5, top + 7, 10, 9, O);          // 아웃라인
    px(cx - 4, top + 7, 8, 8, '#f5f5ef');
    px(cx, top + 8, 1, 7, '#d9d5c8');       // 척추 음영
    // 벨트
    px(cx - 4, top + 15, 8, 1, '#7a4a2a');
    // 랜야드 V (네이비)
    px(cx - 3, top + 8, 1, 1, '#2e4a8f'); px(cx + 2, top + 8, 1, 1, '#2e4a8f');
    px(cx - 2, top + 9, 1, 1, '#2e4a8f'); px(cx + 1, top + 9, 1, 1, '#2e4a8f');
    px(cx - 1, top + 10, 2, 1, '#2e4a8f');
    // 팔(스윙)
    var arm = (frame === 0) ? [1, -1] : (frame === 2) ? [-1, 1] : [0, 0];
    px(cx - 6, top + 8 + arm[0], 2, 6, '#f5f5ef'); px(cx - 6, top + 14 + arm[0], 2, 1, '#f0c39a');
    px(cx + 4, top + 8 + arm[1], 2, 6, '#f5f5ef'); px(cx + 4, top + 14 + arm[1], 2, 1, '#f0c39a');
    // 목
    px(cx - 2, top + 6, 4, 1, '#f0c39a');
    // 넥타이 살짝
    px(cx, top + 7, 1, 2, '#ff6b6b');
    // 머리
    px(cx - 4, top, 8, 7, O);
    px(cx - 3, top, 6, 6, '#0d0b1a'); // 머리카락(검정, 아웃라인과 동일톤이라 형태만)
    px(cx - 3, top + 1, 6, 1, '#241b2f'); // 하이라이트 살짝
    bctx.restore();

    drawDogCompanion(cx, footY);
  }

  // 3콤보 이상 유지 중일 때 캐릭터 옆에서 함께 달리는 강아지(Goldie_v02.png, 32px 셀 4프레임 러닝 사이클)
  function drawDogCompanion(cx, footY) {
    if (!DOG.img || G.stats.combo < 3) return;
    var frame = Math.floor(G.runner.phase * 4) % 4;
    var sx = frame * 32, sy = 32;   // row1 = 달리기 사이클
    var dw = 16, dh = 16;   // 주인공(≈31px)의 절반 크기
    var bob = -Math.abs(Math.sin(G.runner.phase * Math.PI * 2)) * 1.8;
    var dx = cx - 19, dy = footY - dh + 2 + bob;
    bctx.globalAlpha = 0.35; bctx.fillStyle = '#241b2f';
    bctx.beginPath(); bctx.ellipse(dx + dw / 2, footY, 6, 1.9, 0, 0, Math.PI * 2); bctx.fill(); bctx.globalAlpha = 1;
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(DOG.img, sx, sy, 32, 32, Math.round(dx), Math.round(dy), dw, dh);
  }

  // 성장을 앞당겨(front-load) 카드가 빨리 커지고 오래 읽힌다.
  var APPROACH_EASE = 0.72;
  var APPROACH_SPEED = 1.2;   // 메뉴 카드가 다가오는 속도 배율(기존보다 1.2배 빠르게 도달, 이후 게이트 크기로 유지)
  function cardYFor() {
    if (G.sub === 'SPAWN') return 74;
    if (G.sub === 'APPROACH') { var p = clamp((G.rel - G.tSpawn) / (G.tApproach - G.tSpawn) * APPROACH_SPEED, 0, 1); return lerp(74, GATE_Y, Math.pow(p, APPROACH_EASE)); }
    return GATE_Y;
  }
  function cardScaleFor(card) {
    if (G.sub === 'SPAWN') return 0.08;
    if (G.sub === 'APPROACH') return roadHalfWidth(cardYFor()) / HW_PLAYER;
    return 1.0;
  }

  function drawCardSprite(cx, cy, s, menu, isChamp, chosen, punchT, ringT, noLabel) {
    var extra = 1;
    if (chosen && punchT != null) {
      // 1.0 -> 1.28 -> 1.0 펀치 (0.26s)
      extra = 1 + 0.28 * Math.sin(clamp(punchT / 0.26, 0, 1) * Math.PI);
    }
    s = s * extra;
    var w = Math.round(52 * s), h = Math.round(64 * s);
    var x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
    // 챔피언 글로우
    if (isChamp) {
      var gl = 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(G.clock * 9));
      bctx.globalAlpha = gl; px(x0 - 2, y0 - 2, w + 4, h + 4, '#ffe14d'); bctx.globalAlpha = 1;
    }
    // 아웃라인
    px(x0 - 1, y0 - 1, w + 2, h + 2, '#0d0b1a');
    // 프레임(베벨)
    var hi = isChamp ? '#ffe14d' : '#f5f5ef';
    var lo = isChamp ? '#c79a2e' : '#7b6d8d';
    px(x0, y0, w, h, lo);
    px(x0, y0, w, h - 2, hi);
    px(x0 + 2, y0 + 2, w - 4, h - 4, '#241b2f');
    // 얼굴(음식) — 저해상도 버퍼 대신 디스플레이에 선명하게(오버레이) 렌더
    var fx = x0 + 3, fy = y0 + 3, fw = w - 6, fh = h - 14;
    if (menu.face) OVERLAY.push({ face: menu.face, bx: fx, by: fy, bw: fw, bh: fh });
    // 라벨 스트립
    px(x0 + 2, y0 + h - 10, w - 4, 8, '#241b2f');
    // 왕관
    if (isChamp) {
      var mx = Math.round(cx);
      px(mx - 5, y0 - 4, 10, 4, '#ffe14d'); px(mx - 5, y0, 10, 1, '#c79a2e');
      px(mx - 5, y0 - 6, 2, 2, '#ffe14d'); px(mx - 1, y0 - 7, 2, 3, '#ffe14d'); px(mx + 3, y0 - 6, 2, 2, '#ffe14d');
      px(mx - 4, y0 - 3, 1, 1, '#f5f5ef'); px(mx + 3, y0 - 3, 1, 1, '#f5f5ef');
    }
    // 선택 링
    if (chosen && ringT != null && ringT < 0.25) {
      var rr = lerp(8, 40, ringT / 0.25);
      bctx.globalAlpha = 1 - ringT / 0.25; bctx.strokeStyle = '#ffe14d'; bctx.lineWidth = 2;
      bctx.beginPath(); bctx.arc(cx, cy, rr, 0, Math.PI * 2); bctx.stroke(); bctx.globalAlpha = 1;
    }
    // 라벨 텍스트 → 오버레이
    if (s > 0.3 && !noLabel) OVERLAY.push({ text: menu.name, bx: cx, by: y0 + h - 5, size: 7, color: '#f5f5ef', maxW: w - 3, alpha: clamp((s - 0.3) / 0.15, 0, 1) });
  }

  function drawCards() {
    var cards = G.round.cards;
    if (!cards.length) return;
    // approach 중 원경부터(작은 것 먼저) 그리기 위해 y로 정렬
    var order = cards.slice();
    for (var i = 0; i < order.length; i++) {
      var card = order[i];
      if (G.sub === 'RESOLVE' || G.sub === 'CARRY') {
        if (!card.chosen) continue; // 진 카드는 파편으로 대체
        var cyC = GATE_Y - 32;
        if (G.sub === 'CARRY') {
          var pc = clamp((G.rel - G.tResolve) / (G.tCarry - G.tResolve), 0, 1);
          // 챔피언 칩으로 축소 이동
          var tx = 20, ty = 22;
          var sx = lerp(laneX(GATE_Y, card.lane), tx, pc), sy = lerp(cyC, ty, pc);
          var sc = lerp(1, 0.22, pc);
          drawCardSprite(sx, sy, sc, card.menu, card.isChamp || true, false, null, null);
          continue;
        }
        drawCardSprite(laneX(GATE_Y, card.lane), cyC, 1, card.menu, card.menu === G.champion, true, card.punchT, card.ring);
        continue;
      }
      var s = cardScaleFor(card);
      var cy = cardYFor();
      var scx = laneX(cy, card.lane);
      drawCardSprite(scx, cy - 28 * s, s, card.menu, card.isChamp, false, null, null);   // 커진 러너에 라벨이 가리지 않게 위로
    }
  }

  function drawFinish() {
    // 구내식당 배식구 (완주 존). 확보된 도착 연출 시간(FINISH 구간) 전체에 걸쳐 서서히 다가온다.
    var p = clamp((G.clock - RACE_ROUNDS_END) / (FINISH_END - RACE_ROUNDS_END), 0, 1);
    var cy = lerp(74, PLAYER_Y - 6, easeOutQuad(p));
    var hw = roadHalfWidth(cy);
    var s = roadHalfWidth(cy) / HW_PLAYER;

    // 체커 결승선(바닥)
    var w = hw * 2, x0 = VPX - hw, h = 6 * s + 2;
    for (var i = 0; i < 8; i++) px(x0 + i * w / 8, cy, w / 8, h, i % 2 ? '#0d0b1a' : '#f5f5ef');

    // 배식구 카운터(테이블): 스테인리스 상판 + 우드 하단 프레임 + 유리 가림막
    var cw = hw * 2.3, cx0 = VPX - cw / 2, counterTop = cy - 16 * s, counterH = 10 * s;
    bctx.globalAlpha = 0.3; px(cx0 + cw * 0.06, counterTop - 13 * s, cw * 0.88, 13 * s, '#9db9d0'); bctx.globalAlpha = 1;  // 스니즈가드 유리
    px(cx0 - 1, counterTop - 1, cw + 2, counterH + 2, '#0d0b1a');
    px(cx0, counterTop, cw, counterH * 0.35, '#cfd3d6');                    // 스테인리스 상판
    px(cx0, counterTop, cw, Math.max(1, s), '#ffffff');                     // 상판 하이라이트
    px(cx0, counterTop + counterH * 0.35, cw, counterH * 0.65, '#7a4a2a');  // 우드 하단
    px(cx0, counterTop + counterH * 0.35, cw, Math.max(1, s), '#5c3a20');

    // 간판(초록 바탕 + 우드 프레임)
    var signW = hw * 2.0, signH = 12 * s, signY = counterTop - 13 * s - signH - 2 * s;
    px(VPX - signW / 2 - 1, signY - 1, signW + 2, signH + 2, '#7a4a2a');
    px(VPX - signW / 2, signY, signW, signH, '#1f7a4d');
    px(VPX - signW / 2, signY, signW, Math.max(1, s), '#3fae6b');
    OVERLAY.push({ text: '구내식당', bx: VPX, by: signY + signH / 2, size: Math.max(5, 7 * s), color: '#f5f5ef', maxW: signW * 0.9, outline: 0.16 });

    // 김이 나는 그릇(테이블 위) — 중앙은 다가올수록 캐릭터에 가려지므로 좌우로 배치해 항상 보이게
    var bowlY = counterTop - Math.max(1, s);
    drawSteamingBowl(VPX - cw * 0.28, bowlY, s * 0.9);
    drawSteamingBowl(VPX + cw * 0.28, bowlY, s * 0.9);
  }

  function drawSteamingBowl(cx, tableY, s) {
    var bw = 10 * s, bh = 5 * s, bx0 = cx - bw / 2, by0 = tableY - bh;
    px(bx0 - 1, by0 - 1, bw + 2, bh + 2, '#0d0b1a');
    px(bx0, by0, bw, bh, '#f5f5ef');
    px(bx0, by0, bw, Math.max(1, s), '#ffffff');
    px(bx0 + s, by0 + s, Math.max(1, bw - 2 * s), Math.max(1, bh - 2 * s), '#e2452b');   // 국물/메인 음식
    // 위로 흔들리며 옅어지는 스팀 3갈래
    var t = G.clock;
    for (var k = -1; k <= 1; k++) {
      var wob = Math.sin(t * 3 + k * 2) * 2 * s;
      var topY = by0 - (8 + 4 * Math.abs(k)) * s + Math.sin(t * 2 + k) * s;
      bctx.globalAlpha = 0.26 - Math.abs(k) * 0.06;
      px(cx + k * 3 * s + wob, topY, Math.max(1, 2 * s), Math.max(1, 6 * s), '#ffffff');
      bctx.globalAlpha = 1;
    }
  }

  function drawParticles() {
    var i;
    for (i = 0; i < G.shards.length; i++) {
      var sh = G.shards[i];
      bctx.globalAlpha = clamp(sh.life / sh.max, 0, 1);
      px(sh.x, sh.y, sh.w, sh.h, sh.color);
    }
    bctx.globalAlpha = 1;
    for (i = 0; i < G.particles.length; i++) {
      var p = G.particles[i];
      bctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      px(p.x, p.y, p.size, p.size, p.color);
    }
    bctx.globalAlpha = 1;
    for (i = 0; i < G.confetti.length; i++) {
      var cf = G.confetti[i];
      bctx.globalAlpha = clamp(cf.life / cf.max, 0, 1);
      px(cf.x, cf.y, cf.size, cf.size, cf.color);
    }
    bctx.globalAlpha = 1;
  }

  function drawSpeedLines() {
    var m = G.speedMult;
    if (m < 1.35) return;
    var n = m < 1.7 ? 8 : m < 2 ? 16 : 24;
    bctx.globalAlpha = clamp((m - 1.3) * 0.35, 0.1, 0.35);
    bctx.strokeStyle = '#f5f5ef'; bctx.lineWidth = 1;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + G.travel * 0.5;
      var r1 = 20, r2 = 120;
      bctx.beginPath();
      bctx.moveTo(VPX + Math.cos(a) * r1, HORIZON_Y + 20 + Math.sin(a) * r1 * 0.6);
      bctx.lineTo(VPX + Math.cos(a) * r2, HORIZON_Y + 20 + Math.sin(a) * r2 * 0.6);
      bctx.stroke();
    }
    bctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ */
  /* HUD (버퍼 도형 + 오버레이 텍스트)                                    */
  /* ------------------------------------------------------------------ */
  function drawHUD() {
    // 진행바
    var pad = 8, y = 4, w = VW - pad * 2, h = 4;
    px(pad - 1, y - 1, w + 2, h + 2, '#0d0b1a');
    px(pad, y, w, h, '#241b2f');
    var pw = w * progress();
    px(pad, y, pw, h, '#3fae6b'); px(pad, y, pw, 1, '#5affa0');
    // 식판 아이콘(헤드)
    px(pad + pw - 2, y - 1, 4, h + 2, '#ffe14d');
    // 식당 문(끝)
    px(pad + w - 3, y - 2, 4, h + 4, '#1f7a4d');

    // 타이머
    var remain = Math.max(0, FINISH_END - G.clock);
    var mm = Math.floor(remain / 60), ss = Math.floor(remain % 60);
    var tcol = remain < 10 ? '#ff6b6b' : '#f5f5ef';
    var tscale = remain < 10 ? (1 + 0.1 * Math.abs(Math.sin(G.clock * 8))) : 1;
    OVERLAY.push({ text: mm + ':' + (ss < 10 ? '0' : '') + ss, bx: VPX, by: 15, size: 9 * tscale, color: tcol });

    // 라운드 카운터
    if (G.macro === 'RACE')
      OVERLAY.push({ text: 'ROUND ' + (G.roundIndex + 1) + ' / ' + RC, bx: VW - 10, by: 15, size: 6, color: '#fff8e7', align: 'right' });

    // 우측 힌트: 3콤보 달성 전까지만 안내(달성 후에는 강아지가 직접 보여주므로 숨김)
    if (G.macro === 'RACE' && G.stats.bestCombo < 3) {
      OVERLAY.push({ text: '3콤보', bx: VW - 4, by: 98, size: 5.5, color: '#ffe14d', align: 'right', outline: 0.18 });
      OVERLAY.push({ text: '귀여운 강아지', bx: VW - 4, by: 107, size: 5.5, color: '#f5f5ef', align: 'right', outline: 0.18 });
      OVERLAY.push({ text: '등장!', bx: VW - 4, by: 116, size: 5.5, color: '#f5f5ef', align: 'right', outline: 0.18 });
    }

    // 챔피언 칩
    if (G.champion) {
      px(4, 12, 62, 20, '#0d0b1a'); px(5, 13, 60, 18, 'rgba(36,27,47,0.9)');
      px(5, 13, 60, 1, '#ffe14d'); px(5, 30, 60, 1, '#c79a2e');
      bctx.imageSmoothingEnabled = true;
      if (G.champion.face) bctx.drawImage(G.champion.face, 0, 0, FACE, FACE, 7, 15, 14, 14);
      bctx.imageSmoothingEnabled = false;
      px(6, 14, 16, 1, '#ffe14d');
      OVERLAY.push({ text: '👑현재 1위', bx: 24, by: 18, size: 4.5, color: '#ffe14d', align: 'left', shadow: true });
      OVERLAY.push({ text: G.champion.name, bx: 24, by: 26, size: 6, color: '#f5f5ef', align: 'left', maxW: 40 });
    }

    // 토스트
    if (G.toast) {
      var tt = G.toast.t;
      var a = tt < 0.15 ? tt / 0.15 : (tt > 0.8 ? (1 - (tt - 0.8) / 0.2) : 1);
      var yoff = -8 * easeOutCubic(clamp(tt / 0.3, 0, 1));
      OVERLAY.push({ text: G.toast.text, bx: VPX, by: 62 + yoff, size: 11, color: G.toast.color, alpha: clamp(a, 0, 1), outline: 0.16 });
    }
  }

  function drawIntroOverlay() {
    var c = G.clock;
    // 타이틀 펀치 (0.2~2.0)
    if (c < 2.2) {
      var tp = clamp((c - 0.2) / 0.36, 0, 1);
      var sc = c < 0.56 ? easeOutBack(tp) * 1.15 : 1.0;
      OVERLAY.push({ text: '점심 뭐 먹지', bx: VPX, by: 52, size: 20 * sc, color: '#ffe14d', outline: 0.16 });
      OVERLAY.push({ text: '구내식당 런!', bx: VPX, by: 74, size: 16 * sc, color: '#ff6b6b', outline: 0.16 });
      if (c > 0.7) {
        var sa = clamp((c - 0.7) / 0.5, 0, 1);
        OVERLAY.push({ text: '달려라 위메이드 플레이 직원들이여', bx: VPX, by: 83, size: 5.5, color: '#f5f5ef', alpha: sa });
        OVERLAY.push({ text: '점심은 네 손끝에서 결정된다', bx: VPX, by: 91, size: 5.5, color: '#f5f5ef', alpha: sa });
      }
    }
    // 카운트다운
    var num = null, ncol = '#3fae6b';
    if (c >= 1.6 && c < 2.2) { num = '3'; ncol = '#3fae6b'; }
    else if (c >= 2.2 && c < 2.6) { num = '2'; ncol = '#ffe14d'; }
    else if (c >= 2.6 && c < 3.0) { num = '1'; ncol = '#ff6b6b'; }
    if (num) {
      var seg2 = (c - (num === '3' ? 1.6 : num === '2' ? 2.2 : 2.6));
      var dur = num === '3' ? 0.6 : 0.4;
      var t = clamp(seg2 / dur, 0, 1);
      var ns = lerp(1.6, 1.0, easeOutQuad(t));
      OVERLAY.push({ text: num, bx: VPX, by: 90, size: 40 * ns, color: ncol, outline: 0.16 });
      // 링 리플
      var rr = lerp(14, 46, t);
      bctx.globalAlpha = 1 - t; bctx.strokeStyle = '#f5f5ef'; bctx.lineWidth = 2;
      bctx.beginPath(); bctx.arc(VPX, 90, rr, 0, Math.PI * 2); bctx.stroke(); bctx.globalAlpha = 1;
    }
    // GO!
    if (c >= 3.0 && c < 3.6) {
      var gt = clamp((c - 3.0) / 0.12, 0, 1);
      var gs = lerp(2.0, 1.0, easeOutQuad(gt));
      var ga = c > 3.4 ? 1 - (c - 3.4) / 0.2 : 1;
      OVERLAY.push({ text: 'GO!', bx: VPX, by: 90, size: 44 * gs, color: '#ffffff', alpha: clamp(ga, 0, 1), outline: 0.18, outlineColor: '#3fae6b' });
    }
  }

  // 우측 상단, 라운드 카운터 바로 아래 — 화면 상태와 무관하게 항상 표시
  function drawHallOfFame() {
    if (HOF.state === 'loading') return;   // 응답 전 잠깐만 숨김
    var x = VW - 10, y = 26;
    OVERLAY.push({ text: '🏆 명예의 전당', bx: x, by: y, size: 5.5, color: '#ffe14d', align: 'right', outline: 0.18 });
    if (HOF.state === 'ok') {
      for (var i = 0; i < HOF.top.length; i++) {
        var r = HOF.top[i];
        var menu = null;
        for (var j = 0; j < CFG.FOODS.length; j++) { if (CFG.FOODS[j].slug === r.slug) { menu = CFG.FOODS[j]; break; } }
        var label = (i + 1) + '위 ' + (menu ? menu.emoji + menu.name : r.slug) + ' ' + r.pct + '%';
        OVERLAY.push({ text: label, bx: x, by: y + 8 + i * 7.5, size: 4.5, color: '#f5f5ef', align: 'right', maxW: 100, outline: 0.16 });
      }
    } else if (HOF.state === 'empty') {
      OVERLAY.push({ text: '아직 우승 기록이 없어요', bx: x, by: y + 9, size: 4.5, color: '#d9d5c8', align: 'right', outline: 0.16 });
      OVERLAY.push({ text: '완주하면 등록!', bx: x, by: y + 16, size: 4.5, color: '#d9d5c8', align: 'right', outline: 0.16 });
    } else { // error
      OVERLAY.push({ text: '랭킹 서버 연결 안됨', bx: x, by: y + 9, size: 4.5, color: '#ff9a9a', align: 'right', outline: 0.16 });
    }
  }

  function drawTitleScreen() {
    // 상단 헤더 텍스트 (기존 WemadePlay 이미지 배너 제거 → 복도 끝 벽 로고와 겹치지 않게)
    OVERLAY.push({ text: "개발명가 위메이드 플레이's 구내식당", bx: VPX, by: 30, size: 8, color: '#ffe14d', outline: 0.18, maxW: VW - 14 });
    // 타이틀
    OVERLAY.push({ text: '점심 뭐 먹지', bx: VPX, by: 58, size: 22, color: '#ffe14d', outline: 0.16 });
    OVERLAY.push({ text: '구내식당 런!', bx: VPX, by: 82, size: 17, color: '#ff6b6b', outline: 0.16 });
    OVERLAY.push({ text: '레인을 골라 최고의 메뉴를 가리자!', bx: VPX, by: 102, size: 6, color: '#f5f5ef' });
    var blink = (Math.floor(G.clock2 * 2) % 2 === 0);
    if (blink) OVERLAY.push({ text: '클릭 · 탭 · [Space] 로 점심 러시 시작!', bx: VPX, by: 126, size: 8, color: '#3fae6b', outline: 0.16 });
    OVERLAY.push({ text: '← →  또는  A / D  로 레인 이동', bx: VPX, by: 142, size: 5.5, color: '#b9a9c9' });
  }

  function drawDanger(remain) {
    if (G.macro === 'INTRO' || G.macro === 'CELEBRATION') return;
    var col = null, base = 0, pulse = 0, freq = 5;
    if (remain <= 10) { col = [255, 55, 45]; base = 0.14; pulse = 0.13; freq = 11; }
    else if (remain <= 30) { col = [255, 150, 70]; base = 0.07; pulse = 0.03; freq = 5; }
    if (!col) return;
    var a = base + pulse * (0.5 + 0.5 * Math.sin(G.clock * freq));
    var rgb = col[0] + ',' + col[1] + ',' + col[2];
    // 가장자리 비네트(긴박감)
    var grd = bctx.createRadialGradient(VPX, VH * 0.5, VH * 0.22, VPX, VH * 0.5, VH * 0.82);
    grd.addColorStop(0, 'rgba(' + rgb + ',0)');
    grd.addColorStop(1, 'rgba(' + rgb + ',' + (a + 0.14).toFixed(3) + ')');
    bctx.fillStyle = grd; bctx.fillRect(0, 0, VW, VH);
    // 은은한 전체 틴트
    bctx.globalAlpha = a * 0.5; px(0, 0, VW, VH, 'rgb(' + rgb + ')'); bctx.globalAlpha = 1;
  }

  function drawCelebration() {
    var t = G.clock - FINISH_END;
    // 딤 배경
    bctx.globalAlpha = 0.5; px(0, 0, VW, VH, '#0d0b1a'); bctx.globalAlpha = 1;
    OVERLAY.push({ text: '오늘의 우승 점심 메뉴', bx: VPX, by: 18, size: 10, color: '#ffe14d', outline: 0.16 });
    // 우승 카드 (라벨은 아래 히어로 텍스트로 대체 → noLabel)
    if (G.finalWinner) {
      var st = clamp(t / 0.5, 0, 1);
      var sc = t < 0.5 ? easeOutBack(st) * 1.25 : lerp(1.25, 1.12, clamp((t - 0.5) / 0.5, 0, 1));
      drawCardSprite(VPX, 78, sc, G.finalWinner, true, false, null, null, true);
      var nm = G.finalWinner.name.substr(0, Math.floor(G.typeChars));
      OVERLAY.push({ text: nm, bx: VPX, by: 134, size: 13, color: '#f5f5ef', outline: 0.16 });
    }
    if (t > 1.2) OVERLAY.push({ text: G.winnerLine, bx: VPX, by: 150, size: 6.5, color: '#ffd98a', maxW: VW - 16 });
    if (t > 1.6) OVERLAY.push({ text: '방어 x' + G.stats.retains + '  ·  역전 x' + G.stats.upgrades + '  ·  최고 콤보 x' + G.stats.bestCombo, bx: VPX, by: 162, size: 5.5, color: '#d9d5c8' });
    if (t > 2.0) {
      var blink = (Math.floor(t * 2) % 2 === 0);
      if (blink) OVERLAY.push({ text: '[R] · 탭하여 다시 달리기', bx: VPX, by: 173, size: 7, color: '#3fae6b', outline: 0.16 });
    }
  }

  /* ------------------------------------------------------------------ */
  /* 프레임 렌더                                                         */
  /* ------------------------------------------------------------------ */
  var OVERLAY = [];
  function render() {
    OVERLAY = [];
    // --- 버퍼(픽셀 월드) ---
    bctx.imageSmoothingEnabled = false;
    drawCorridorBg();
    drawRoad();
    drawFarWall();
    drawProps();

    if (G.macro === 'FINISH' || (G.macro === 'RACE' && G.clock > RACE_ROUNDS_END - 0.5)) drawFinish();

    // 함께 달리는 무리는 주인공 뒤쪽 → 카드보다 먼저 그려 카드를 가리지 않게
    if (G.macro !== 'CELEBRATION') drawChasers();
    if (G.started && G.macro === 'RACE') drawCards();
    if (G.macro !== 'CELEBRATION') drawRunner();
    drawSpeedLines();
    drawParticles();

    // 긴박 배경 틴트/비네트 (남은 시간 30초/10초)
    if (G.started) drawDanger(Math.max(0, FINISH_END - G.clock));

    if (G.started && G.macro !== 'CELEBRATION') drawHUD();

    // 점심메뉴 명예의 전당 — 화면 상태와 무관하게 항상(라운드 카운터 바로 아래) 표시
    drawHallOfFame();

    // 상태별 화면(버퍼 픽셀 파트 + OVERLAY 텍스트 큐잉) — 반드시 블릿 이전
    if (!G.started) drawTitleScreen();
    else if (G.macro === 'INTRO') drawIntroOverlay();
    else if (G.macro === 'CELEBRATION') drawCelebration();

    // 안내 배너(30초/10초 남음)
    if (G.announce) {
      var at = G.announce.t;
      var aa = at < 0.18 ? at / 0.18 : (at > 1.5 ? 1 - (at - 1.5) / 0.4 : 1);
      var asc = at < 0.32 ? easeOutBack(clamp(at / 0.32, 0, 1)) : 1;
      OVERLAY.push({ text: G.announce.text, bx: VPX, by: 46, size: 17 * asc, color: G.announce.color, alpha: clamp(aa, 0, 1), outline: 0.2, outlineColor: '#2b0a0a' });
      if (G.announce.sub) OVERLAY.push({ text: G.announce.sub, bx: VPX, by: 62, size: 7, color: '#fff4c2', alpha: clamp(aa, 0, 1), outline: 0.18 });
    }

    // 캐릭터 말풍선
    if (G.bubble && G.macro !== 'CELEBRATION') {
      var bt = G.bubble.t;
      var ba = bt < 0.15 ? bt / 0.15 : (bt > 1.9 ? 1 - (bt - 1.9) / 0.4 : 1);
      OVERLAY.push({ bubble: true, text: G.bubble.text, bx: G.runner.x, by: PLAYER_Y - 30, alpha: clamp(ba, 0, 1), size: 6.5 });
    }

    // 플래시
    if (G.flash > 0) { bctx.globalAlpha = clamp(G.flash / 0.09, 0, 1) * 0.9; px(0, 0, VW, VH, G.flashColor); bctx.globalAlpha = 1; }

    // --- 디스플레이 블릿 ---
    dctx.fillStyle = '#0d0b1a';
    dctx.fillRect(0, 0, display.width, display.height);
    dctx.imageSmoothingEnabled = false;
    dctx.drawImage(buffer, 0, 0, VW, VH, Math.round(G.shakeX * SCALE), Math.round(G.shakeY * SCALE), Math.round(VW * SCALE), Math.round(VH * SCALE));

    // OVERLAY 리스트 렌더 (크리스프 텍스트, 블릿 이후)
    for (var i = 0; i < OVERLAY.length; i++) {
      var o = OVERLAY[i];
      if (o.face) {
        // 음식 사진: 부드럽게(선명하게) 확대 렌더 — 도트화 완화
        dctx.imageSmoothingEnabled = true; dctx.imageSmoothingQuality = 'high';
        dctx.globalAlpha = (o.alpha != null ? o.alpha : 1);
        dctx.drawImage(o.face, 0, 0, o.face.width, o.face.height,
          Math.round(mapX(o.bx)), Math.round(mapY(o.by)), Math.round(o.bw * SCALE), Math.round(o.bh * SCALE));
        dctx.globalAlpha = 1; dctx.imageSmoothingEnabled = false;
        continue;
      }
      if (o.bubble) { drawBubble(o.text, o.bx, o.by, o.size, o.alpha, o.bias || 0); continue; }
      drawText(o.text, o.bx, o.by, o.size, o.color, { align: o.align, alpha: o.alpha, maxW: o.maxW, outline: o.outline, outlineColor: o.outlineColor, shadow: o.shadow });
    }
  }

  /* ------------------------------------------------------------------ */
  /* 메인 루프                                                           */
  /* ------------------------------------------------------------------ */
  G.clock2 = 0;
  function loop(now) {
    var dt = (now - G.last) / 1000;
    G.last = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.05) dt = 0.05;
    G.clock2 += dt;
    if (!G.paused) { update(dt); }
    render();
    requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------------ */
  /* 부트                                                                */
  /* ------------------------------------------------------------------ */
  loadMenus();
  // neodgm 픽셀 폰트 프리로드(캔버스가 로드 후 사용하도록)
  try { if (document.fonts && document.fonts.load) { document.fonts.load("16px 'neodgm'"); document.fonts.load("32px 'neodgm'"); } } catch (e) {}
  G.last = performance.now();
  requestAnimationFrame(loop);

})();
