/* =======================================================================
   점심 뭐 먹지: 구내식당 런!  —  사용자 편집 파일 (config)
   -----------------------------------------------------------------------
   여기 있는 값만 손대면 됩니다. 게임 엔진 코드는 game.js 에 있습니다.

   [ 음식 사진 추가하기 ]
   1) assets/menus/ 폴더에 사진을 넣습니다.
   2) 파일 이름 = 아래 각 메뉴의 slug + 확장자.
        예) 제육볶음 -> assets/menus/jeyuk-bokkeum.png
      지원 확장자: .png / .jpg / .jpeg / .webp  (자동 탐색)
   3) 새로고침(F5) 하면 사진이 카드에 자동 반영됩니다.
      사진이 없으면 색상+이모지 플레이스홀더 카드로 예쁘게 표시됩니다.

   메뉴를 추가/삭제/이름변경하려면 아래 FOODS 배열만 수정하세요.
   ======================================================================= */

window.CONFIG = {
  // 음식 사진이 들어갈 폴더 (끝에 / 포함)
  photoDir: 'assets/menus/',
  // 로더가 순서대로 시도할 확장자 (현재 사진은 모두 최적화된 .jpg)
  photoExts: ['jpg', 'png', 'webp', 'jpeg'],

  // 한 판(레이스) 길이 및 라운드 수 — 필요 시 조정 (총 체감 60초 이내 권장)
  raceSeconds: 40,   // 구내식당 완주까지
  roundCount: 7,     // 배식대 대결 횟수

  // 메뉴 목록 (한국 구내식당 대표 메뉴)
  // name : 카드에 표시되는 이름
  // emoji: 사진 없을 때 플레이스홀더에 크게 표시
  // color: 플레이스홀더 카드 배경색 (사진이 있으면 테두리 강조색으로만 사용)
  // slug : 사진 파일 이름 (assets/menus/{slug}.png)
  FOODS: [
    { name: '제육볶음',     emoji: '🥘', color: '#E8452B', slug: 'jeyuk-bokkeum' },
    { name: '김치찌개',     emoji: '🍲', color: '#D6402C', slug: 'kimchi-jjigae' },
    { name: '돈까스',       emoji: '🍖', color: '#D9922E', slug: 'donkatsu' },
    { name: '된장찌개',     emoji: '🥣', color: '#A9713B', slug: 'doenjang-jjigae' },
    { name: '불고기',       emoji: '🥩', color: '#A6402E', slug: 'bulgogi' },
    { name: '비빔밥',       emoji: '🍚', color: '#F26B3A', slug: 'bibimbap' },
    { name: '카레라이스',   emoji: '🍛', color: '#E4952A', slug: 'curry-rice' },
    { name: '짜장면',       emoji: '🍚', color: '#5A4632', slug: 'jjajang' },
    { name: '순두부찌개',   emoji: '🍲', color: '#E4533A', slug: 'sundubu-jjigae' },
    { name: '부대찌개',     emoji: '🍲', color: '#C7452F', slug: 'budae-jjigae' },
    { name: '오므라이스',   emoji: '🍳', color: '#F0A83C', slug: 'omurice' },
    { name: '오징어덮밥',     emoji: '🍚', color: '#DD4A2C', slug: 'oh-deopbap' },
    { name: '닭갈비',       emoji: '🍗', color: '#D84530', slug: 'dakgalbi' },
    { name: '뼈해장국',       emoji: '🍲', color: '#B23A2A', slug: 'gamjatang' },
    { name: '육개장',       emoji: '🌶️', color: '#C33324', slug: 'yukgaejang' },
    { name: '돼지국밥',       emoji: '🥣', color: '#35705C', slug: 'piggukbap' },
    { name: '잔치국수',     emoji: '🍜', color: '#C9B487', slug: 'janchi-guksu' },
    { name: '비빔국수',     emoji: '🍜', color: '#E24A2E', slug: 'bibim-guksu' },
    { name: '들기름막국수',       emoji: '🍜', color: '#5E93AE', slug: 'mak-guksu' },
    { name: '김치볶음밥',   emoji: '🍚', color: '#DB4A2E', slug: 'kimchi-bokkeumbap' },
    { name: '갈비탕',       emoji: '🍲', color: '#B8895A', slug: 'galbitang' },
    { name: '짬뽕',       emoji: '🍗', color: '#C9BFA6', slug: 'jjambbong' },
    { name: '고등어구이',   emoji: '🐟', color: '#4F7A99', slug: 'godeungeo-gui' },
    { name: '치킨마요덮밥', emoji: '🍗', color: '#E0A63C', slug: 'chicken-mayo-deopbap' },
    { name: '떡볶이',       emoji: '🌶️', color: '#E23B2C', slug: 'tteokbokki' },
    { name: '김밥',         emoji: '🍙', color: '#3F8055', slug: 'gimbap' },
    { name: '가츠동',         emoji: '🍜', color: '#7A5A38', slug: 'gachdong' },
    { name: '닭볶음탕',     emoji: '🍗', color: '#C83E2A', slug: 'dakbokkeumtang' },
    { name: '신라면',         emoji: '🍜', color: '#E2482C', slug: 'ramyeon' },
    { name: '순대국밥',     emoji: '🍳', color: '#F0C24A', slug: 'sundae' },
    { name: '마라탕',     emoji: '🌶️', color: '#D14A34', slug: 'mara' },
    { name: '돈고츠라멘',     emoji: '🥬', color: '#5C8A3A', slug: 'dongo' },
  ],
};
