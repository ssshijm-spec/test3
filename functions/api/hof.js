/* =======================================================================
   Cloudflare Pages Function — GET /api/hof
   "점심메뉴 명예의 전당": 지금까지 모든 참여자의 우승 집계에서 상위 5개
   메뉴와 득표율(%)을 반환한다. KV 바인딩(HOF_KV)이 없으면 빈 목록을
   안전하게 반환한다(게임은 정상 동작, 패널만 표시되지 않음).

   응답 형식: { ok: true, total: 87, top: [{ slug, count, pct }, ...] }
   ======================================================================= */

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet({ env }) {
  try {
    // kv 필드: KV 네임스페이스(HOF_KV) 바인딩 여부 진단용.
    // 브라우저에서 https://<사이트>/api/hof 를 열어 "kv":false 이면 대시보드에서 KV 바인딩이 필요.
    if (!env.HOF_KV) return json({ ok: true, total: 0, top: [], kv: false });

    const list = await env.HOF_KV.list({ prefix: 'wins:' });
    var rows = [];
    var total = 0;
    for (var i = 0; i < list.keys.length; i++) {
      var name = list.keys[i].name;
      var v = parseInt(await env.HOF_KV.get(name), 10) || 0;
      if (v <= 0) continue;
      total += v;
      rows.push({ slug: name.slice(5), count: v });   // 'wins:' 접두사(5자) 제거
    }
    rows.sort(function (a, b) { return b.count - a.count; });
    var top = rows.slice(0, 5).map(function (r) {
      return { slug: r.slug, count: r.count, pct: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0 };
    });

    return json({ ok: true, total: total, top: top, kv: true });
  } catch (e) {
    return json({ ok: false, total: 0, top: [], kv: true, error: String(e) }, 500);
  }
}

export async function onRequestPost() {
  return json({ ok: false, error: 'use GET' }, 405);
}
