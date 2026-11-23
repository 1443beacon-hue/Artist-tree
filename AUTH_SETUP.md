# Artistree 로그인·내 트리 저장 설정

## 현재 상태

- Google / Kakao 기본 Supabase OAuth, Naver용 서버 어댑터, 계정별 저장 UI와 SQL을 구현했습니다.
- 전용 프로젝트 `vtttqbfdwhmmzlhiissu`에 저장용 테이블/RLS를 적용하고, https://artist-tree.vercel.app/ 에 기본 배포했습니다. 로그인 복귀 주소도 저장했습니다.
- **소셜 개발자 앱 등록과 실제 계정 로그인/클라우드 저장 검증은 아직 진행 중입니다.** 완료한 배포·DB 검증과 남은 항목은 [DEPLOYMENT.md](DEPLOYMENT.md)를 참고하세요.
- Google 웹 클라이언트와 Supabase 연결 및 배포를 완료했습니다. 현재 Google 앱은 외부/테스트 모드이며, 소유자 계정의 정보 제공 승인과 클라우드 저장 검증이 남아 있습니다. Kakao/Naver는 아직 비활성입니다.
- 기존에 연결된 다른 앱의 Supabase 프로젝트는 수정하지 않습니다. 기존 브라우저 저장 키도 바꾸지 않습니다.
- 비용이 드는 프로젝트·서비스·업그레이드는 자동으로 만들지 않습니다.

## 1. 전용 무료 프로젝트

1. [Supabase Dashboard](https://supabase.com/dashboard)에서 무료 플랜에 새 프로젝트 **Artistree**를 만듭니다. 무료 프로젝트 한도를 초과하면 중단하고 비용부터 확인합니다.
2. 데이터베이스 비밀번호는 비밀번호 관리자에 보관합니다. **비밀번호, OAuth Client Secret, secret/service-role 키, 개인 액세스 토큰을 채팅에 보내지 마세요.**
3. 개발 도구의 Supabase 연결도 **새 프로젝트로 변경**합니다. 프로젝트 URL을 확인하기 전에는 마이그레이션을 적용하지 않습니다.
4. 새 프로젝트의 API URL과 **Publishable key (`sb_publishable_...`)**만 로컬 `.env`의 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`에 설정합니다. 서버는 secret/service-role/legacy JWT 키를 이 항목으로 공개하지 않습니다.
5. 검토 후 `supabase/migrations/20261123133854_artistree_saved_trees.sql`을 **새 프로젝트에만** 적용합니다. 기존 테이블을 삭제하는 SQL은 없습니다.
6. Auth → URL Configuration의 Site URL은 최종 Vercel 주소로 설정합니다. Redirect URLs에는 최종 주소의 `/`와 사용하는 로컬 주소를 **각각 정확하게** 등록합니다. Spotify-only 화면의 `source`, `id`, `name` 쿼리도 동일한 루트로 돌아옵니다. 프로젝트 전체를 허용하는 넓은 도메인 와일드카드는 피합니다.

Auth 익명 사용자 생성은 필요 없습니다. 비로그인 탐색과 로컬 저장은 기존 Node API/브라우저 저장으로 동작합니다.

### 데이터 접근 규칙

`artistree_saved_trees`는 `(owner_id, scope, id)`를 키로 사용합니다.

- `authenticated` 역할도 `auth.uid() = owner_id`인 행만 조회·추가·삭제할 수 있습니다.
- `anon`에는 테이블 접근 권한이 없습니다. 다른 소유자를 지정한 삽입도 RLS가 차단합니다.
- 스냅샷은 변경 불가: UPDATE 권한/정책이 없습니다. 저장은 새 스냅샷, 삭제는 명시적 확인으로 합니다.
- 계정/화면별 20개 제한은 트랜잭션 잠금을 사용하는 DB 트리거에서도 적용합니다.
- 본문 크기·기본 구조 제약과 클라이언트의 기존 엄격한 스냅샷 검증을 함께 사용합니다.
- 사용자 삭제 시 저장 트리는 FK `ON DELETE CASCADE`로 지워집니다. 앱 내 계정 탈퇴 UI는 아직 없습니다.

## 2. Google

1. Google Cloud Console에서 웹 OAuth Client를 생성하고 동의 화면/테스트 사용자를 설정합니다.
2. Supabase Auth → Providers → Google에 표시되는 Callback URL을 Google의 Authorized redirect URI에 등록합니다.
3. Client ID/Secret은 **Supabase의 Google Provider 설정**에 입력합니다. Artistree 브라우저 코드에는 넣지 않습니다.
4. Google Provider를 활성화합니다. 개발/테스트 상태라면 허용된 테스트 계정으로 먼저 확인합니다.
5. Artistree 환경변수 `ARTISTREE_AUTH_PROVIDERS`에 `google`을 추가하고 재시작/재배포합니다.

공식 문서: https://supabase.com/docs/guides/auth/social-login/auth-google

## 3. Kakao

1. Kakao Developers에서 앱을 만들고 Kakao Login을 활성화합니다.
2. **REST API 키**를 Supabase Kakao의 Client ID로 사용합니다.
3. Kakao Login Client Secret을 활성화해 Supabase Kakao의 Client Secret에 입력합니다.
4. Supabase가 보여주는 Callback URL을 Kakao Redirect URI에 정확히 등록합니다.
5. 이메일을 필수로 요청하지 않는 구성을 권장합니다. Supabase의 이메일 없는 로그인 허용 설정을 확인합니다. 불필요한 생년월일·전화번호·성별 등의 동의 항목은 요청하지 않습니다.
6. Provider 활성화 후 `ARTISTREE_AUTH_PROVIDERS`에 `kakao`를 추가하고 재시작/재배포합니다.

공식 문서: https://supabase.com/docs/guides/auth/social-login/auth-kakao

## 4. Naver — 직접 기본 Provider로 지정하지 않습니다

Supabase에는 기본 `naver` Provider가 없습니다. `custom:naver`와 이 저장소의 `api/naver-auth.mjs` 어댑터를 사용합니다. Naver의 중첩 `response.id`와 토큰 교환에 필요한 원본 `state`를 일반 OAuth2 엔드포인트 설정만으로 처리한다고 가정하지 않습니다.

### 서버 환경변수

최종 고정 HTTPS Vercel 주소가 먼저 필요합니다.

```dotenv
PUBLIC_APP_ORIGIN=https://YOUR-ARTISTREE.vercel.app
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
NAVER_ADAPTER_SECRET=
ARTISTREE_NAVER_ADAPTER_VERIFIED=false
```

`NAVER_ADAPTER_SECRET`은 **임의의 32바이트 이상을 base64url로 인코딩한 비밀 값**으로 생성합니다. 예:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

출력은 로컬 `.env`/Vercel 환경변수와 Supabase Custom Provider에만 입력하고 채팅·Git에 넣지 않습니다. 모든 배포 인스턴스는 같은 값을 써야 합니다. 값을 바꾸면 진행 중인 네이버 로그인/짧은 프로필 토큰은 무효화되지만 이미 발급된 Supabase 세션과 트리 소유권은 변하지 않습니다.

### Naver Developers 설정

1. 네이버 로그인 앱을 등록하고 서비스 URL을 최종 Artistree HTTPS 주소로 설정합니다.
2. Naver Callback URL은 **`https://YOUR-ARTISTREE.vercel.app/api/auth/naver/callback`** 입니다. Google/Kakao처럼 Supabase Callback을 바로 넣는 구성과 다릅니다.
3. 앱 ID/Secret을 위 서버 환경변수에 설정합니다.
4. 최소한의 프로필 동의만 요청합니다. 어댑터는 안정적인 앱별 사용자 ID와 선택적인 별명/이름만 사용하고 이메일/전화번호/생일/사진은 반환하지 않습니다.

### Supabase Custom Provider 설정

Auth → Providers → New Provider → Manual OAuth2:

| 항목 | 값 |
| --- | --- |
| Identifier | `custom:naver` |
| Client ID | `NAVER_CLIENT_ID`와 같은 값 |
| Client Secret | **`NAVER_ADAPTER_SECRET`** — 원본 Naver Secret이 아닙니다 |
| Authorization URL | `https://YOUR-ARTISTREE.vercel.app/api/auth/naver/authorize` |
| Token URL | `https://YOUR-ARTISTREE.vercel.app/api/auth/naver/token` |
| UserInfo URL | `https://YOUR-ARTISTREE.vercel.app/api/auth/naver/userinfo` |
| PKCE | **켜기**, S256 사용 |
| Email optional | **켜기** |
| Scopes | 필요 없는 scope를 추가하지 않음 |

Supabase가 표시하는 외부 Provider Callback은 `https://PROJECT.supabase.co/auth/v1/callback`이어야 합니다. 커스텀 Auth 도메인은 현재 코드에서 허용하지 않습니다. 추가 매핑은 필요 없습니다: 어댑터가 `sub`를 제공합니다.

설정·배포가 완료된 테스트 환경에서 `ARTISTREE_AUTH_PROVIDERS=google,kakao,naver`와 `ARTISTREE_NAVER_ADAPTER_VERIFIED=true`로 로그인 흐름을 시험합니다. 성공·취소·재로그인·저장까지 확인한 환경에만 이 설정을 유지합니다. 필수 서버 설정이 빠지면 네이버 버튼은 활성화되지 않습니다.

### 어댑터의 경계

- Supabase → 어댑터의 PKCE를 검증하고, Naver 원본 state를 토큰 교환까지 유지합니다.
- state는 10분, 코드 전달용 암호화 봉투는 2분, 프로필 조회용 토큰은 최대 5분 유효합니다.
- 인증된 암호화로 컨텍스트·유효기간을 보호하며, 원본 Naver 코드는 Naver의 일회성 교환 규칙에 의존합니다.
- Token URL은 POST form과 Adapter Client Secret을 요구합니다. Basic/form 두 방식의 클라이언트 인증을 지원합니다.
- 외부 요청은 Naver의 고정 공식 URL 두 곳만 사용하고, 리다이렉트·과대 응답·임의 프로필 ID·위조 봉투를 거부합니다.
- 원본 Naver 토큰과 refresh token은 브라우저나 Supabase에 반환하지 않습니다. 프로필 조회에만 쓸 수 있는 짧은 불투명 토큰을 반환합니다.
- Supabase 세션/JWT를 직접 생성하지 않고, 이메일 확인을 꾸며내거나 이름으로 다른 소셜 계정을 합치지 않습니다.
- 실제 Provider와의 호환성은 앱 등록 후 반드시 실계정으로 확인해야 합니다. fixture 테스트가 실서비스 검증을 대신하지 않습니다.

공식 문서:
- https://supabase.com/docs/guides/auth/custom-oauth-providers
- https://developers.naver.com/docs/login/api/api.md
- https://developers.naver.com/docs/login/profile/profile.md

## 5. 사용자 흐름·기존 저장본

- 로그인 없이 탐색하고 **This browser**에 계속 저장할 수 있습니다.
- 로그인 후 Save 팝오버에서 **My account**를 명시적으로 선택해 새 트리를 저장합니다. 로그인만으로 업로드하지 않습니다.
- Browser maps의 **Copy to account**는 선택한 한 개만 복사합니다. 원래 로컬 저장본은 유지하며 재시도 시 기존 계정 스냅샷을 덮어쓰지 않습니다.
- Main/Spotify 지도와 목록은 로컬/클라우드 모두 분리합니다.
- 로그인으로 페이지를 나가기 전, 현재 탐색만 같은 탭의 sessionStorage에 임시 보관합니다. 돌아오면 24시간 내의 검증된 임시 지도를 복원하고 제거합니다. 이것은 클라우드 저장이 아닙니다.
- 로그아웃/계정 전환 시 목록과 지연 응답을 무효화합니다. 로그인 세션은 Supabase SDK의 프로젝트별 전용 키로 저장하고, 지도 스냅샷에는 넣지 않습니다.
- 다른 소셜 제공자로 로그인하면 이메일/보안 정책에 따라 **별도 계정**이 될 수 있습니다. 트리를 이름/이메일만 보고 자동 이전하거나 계정을 강제로 합치지 않습니다. 계정 연결 UI는 후속 작업입니다.
- Streamlit iframe 안에서는 소셜 버튼을 끄고 **Open full Artistree site**를 제공합니다. 실제 로그인·클라우드 저장은 최상위 Vercel 페이지에서 사용합니다.

## 6. 검증

```sh
npm ci
npm run check
npm test
npm run build:vercel
```

이 환경에는 Docker가 없어 전체 Supabase 로컬 스택 대신 PGlite의 실제 PostgreSQL 엔진에서 역할/RLS/제약/트리거/FK를 테스트합니다. **호스팅된 Auth·Data API, 동시 트랜잭션, 실제 제공자 동의 화면은 별도 검증이 필요합니다.** 원격 적용 후 프로젝트 보안/성능 advisories도 점검합니다.

배포 전에는 두 실제 테스트 계정 A/B로 저장·조회·삭제를 확인하고, B의 토큰으로 A의 행 조회/삭제/다른 소유자 삽입이 차단되는지 검사합니다. 로그인 취소, 네트워크 오류, 토큰 만료, 여러 탭 로그아웃, 모바일, Spotify-only 리턴 URL, 기존 브라우저 지도 복사도 확인합니다.
