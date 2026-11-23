# 도립 물구나무 훈련소 — 웹사이트

정적 사이트입니다. 빌드 과정이 없고, 파일을 그대로 올리면 GitHub Pages에서 바로 열립니다.
회원 로그인·승인·영상 목록만 Supabase를 씁니다.

## 파일 구성

| 파일 | 역할 |
| --- | --- |
| `index.html` | 화면 뼈대 (소개 / 회원 가이드북 / 관리자) |
| `styles.css` | 디자인 (모바일 우선, 다크 차콜 + 앰버) |
| `app.js` | 로그인·승인 확인·영상 재생·관리자 기능 |
| `config.js` | **사람이 고치는 유일한 파일.** Supabase 키, 주소, 문의 링크 |
| `supabase-setup.sql` | Supabase에서 한 번 실행하는 DB 설정 (표·보안 규칙) |
| `README.md` | 이 문서 |

## 1. Supabase 준비 (한 번만)

1. https://supabase.com → `Continue with GitHub` 로 가입
2. `New project` → 이름 `dolib-studio`, Region **Northeast Asia (Seoul)**
3. 좌측 메뉴 **SQL Editor** → `supabase-setup.sql` 내용 전체를 붙여넣고 **Run**
4. 좌측 **Project Settings → API** 에서 두 값을 복사
   - `Project URL` → `config.js` 의 `SUPABASE_URL`
   - `anon public` 키 → `config.js` 의 `SUPABASE_ANON_KEY`
5. **Authentication → Providers → Email** 에서
   - 회원가입을 간단히 하려면 `Confirm email` 을 **끄는 것을 권장**합니다.
     (켜 두면 가입 확인 메일의 링크를 눌러야 로그인됩니다.)
   - **Authentication → URL Configuration → Site URL** 에 배포 주소를 넣습니다.
     예: `https://doripman.github.io/dolib-studio/`

> `anon public` 키는 공개되어도 되는 키입니다. 실제 보호는 `supabase-setup.sql` 의 RLS가 합니다.
> **`service_role` 키는 절대 `config.js` 에 넣지 마세요.** 그 키는 모든 보안 규칙을 통과합니다.

## 2. config.js 채우기

```js
SUPABASE_URL: 'https://abcdefghijk.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6...',
```

같은 파일에서 주소·문의 링크도 바꿀 수 있습니다.

```js
links: {
  instagram: 'https://www.instagram.com/...',
  kakao: 'https://pf.kakao.com/_...',
  naverPlace: 'https://naver.me/...',
  booking: ''
}
```

빈 칸으로 두면 그 버튼은 "아직 연결되지 않은 링크입니다" 안내만 띄웁니다. (사이트는 정상 동작)

## 3. GitHub Pages 배포

`index.html` 이 저장소 **최상위**에 있어야 합니다.

```bash
# 저장소를 새로 만들 경우
git init
git add index.html styles.css app.js config.js supabase-setup.sql README.md .nojekyll
git commit -m "도립 물구나무 훈련소 웹사이트"
git branch -M main
git remote add origin https://github.com/doripman/dolib-studio.git
git push -u origin main
```

그다음 GitHub 저장소 → **Settings → Pages**
- Source: `Deploy from a branch`
- Branch: `main` / `/ (root)` → **Save**

1~2분 뒤 `https://doripman.github.io/dolib-studio/` 에서 열립니다.
(저장소가 Public 이어야 무료 Pages가 켜집니다.)

## 4. 관리자(도립맨님) 계정 만들기

1. 배포된 사이트 → `회원 가이드북` → `회원가입` 으로 본인 이메일 가입
2. Supabase **SQL Editor** 에서 아래 한 줄 실행 (이메일만 본인 것으로)

```sql
update public.profiles
   set approved = true,
       role     = 'admin'
 where email = 'jasonasa3172@gmail.com';
```

3. 사이트에서 다시 로그인하면 상단·하단에 **관리자** 탭이 생깁니다.

## 5. 운영 — 영상 올리기

1. 유튜브에 영상을 **일부 공개(Unlisted)** 로 올립니다. (검색에는 안 뜨고 링크로만 재생)
2. 사이트 → 관리자 → **영상 관리** → 오른쪽 위 `영상 추가` → 챕터·제목·설명·주소 입력 → `추가하기`
3. 주소는 아래 형식을 모두 알아서 처리합니다.
   - `https://youtu.be/영상ID`
   - `https://www.youtube.com/watch?v=영상ID&t=90`
   - `https://www.youtube.com/shorts/영상ID`
   - `https://vimeo.com/123456789`
   - `https://.../video.mp4`

회원은 `회원 승인` 탭에서 한 번 누르면 승인, 다시 누르면 승인 취소됩니다.
관리자 본인 계정은 실수로 잠그지 않도록 버튼 대신 `관리자 계정` 표시만 나갑니다.

## 6. 자주 고치는 곳

| 바꾸고 싶은 것 | 위치 |
| --- | --- |
| 수강권 가격·환불 규정 | `index.html` 의 `#pricing` 섹션 |
| 소개 문구 | `index.html` 의 `#philosophy`, `#program` |
| 주소·지도 검색어 | `config.js` 의 `studio` |
| 문의 버튼 링크 | `config.js` 의 `links` |
| 승인 대기 안내 문구 | `config.js` 의 `ui` |

## 7. 참고

- 영상의 화면 녹화·링크 복사까지 완전히 막는 것은 유료 DRM 영역입니다.
  이 사이트는 **승인된 회원만 목록을 볼 수 있게** 하는 수준까지 보호합니다.
- 회원 비밀번호는 Supabase가 암호화해 보관하며, 사이트에는 저장되지 않습니다.
