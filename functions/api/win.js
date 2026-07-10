/* =======================================================================
   Cloudflare Pages Function — POST /api/win
   레이스가 끝나 우승 메뉴가 정해지면 클라이언트가 이 엔드포인트로
   {slug: "jeyuk-bokkeum"} 를 보낸다. Cloudflare KV(바인딩 이름: HOF_KV)에
   메뉴별 우승 횟수를 누적 저장한다.

   [ 사전 준비 — Cloudflare 대시보드에서 1회 설정 필요 ]
   1) dash.cloudflare.com → Workers & Pages → KV → Create a namespace
      (이름 예: lunch-hof)
   2) 이 Pages 프로젝트 → Settings → Functions → KV namespace bindings
      → Add binding: Variable name = HOF_KV, KV namespace = 위에서 만든 것
      (Production/Preview 둘 다 등록)
   3) 재배포하면 바로 동작한다. (바인딩 전에는 아래 코드가 안전하게
      "KV not bound" 오류만 반환하고, 게임 자체에는 영향 없음)
   ======================================================================= */

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.HOF_KV) return json({ ok: false, error: 'KV not bound' }, 500);

    const body = await request.json().catch(() => null);
    const slug = body && typeof body.slug === 'string' ? body.slug : '';
    // 슬러그 형식만 검증(파일명 규칙과 동일). 존재하는 메뉴인지는 클라이언트 config.js 기준이며
    // 서버는 콘텐츠에 결합되지 않도록 형식 검증만 수행한다.
    if (!/^[a-z0-9-]{1,40}$/.test(slug)) return json({ ok: false, error: 'invalid slug' }, 400);

    const key = 'wins:' + slug;
    const cur = parseInt(await env.HOF_KV.get(key), 10) || 0;
    await env.HOF_KV.put(key, String(cur + 1));

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: 'server error' }, 500);
  }
}

export async function onRequestGet() {
  return json({ ok: false, error: 'use POST' }, 405);
}
