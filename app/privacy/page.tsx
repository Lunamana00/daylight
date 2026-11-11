export default function PrivacyPage() {
  return <main className="public-document">
    <a className="text-button" href="/">← daylight</a>
    <h1>개인정보처리방침</h1>
    <section>
      <h2>처리하는 정보와 목적</h2>
      <p>daylight는 초대 여부 확인과 계정 연결을 위해 Google 계정 식별자와 이메일 주소를 사용합니다. 사용자가 정한 표시 이름, 할 일, 완료 상태, 프로젝트 기록, 링크와 첨부파일을 저장하여 웹과 Mac 앱에서 제공합니다.</p>
    </section>
    <section>
      <h2>Google 캘린더 연결</h2>
      <p>캘린더 연결은 선택 사항입니다. 사용자가 허용하면 접근 가능한 캘린더 목록을 표시하고, 직접 선택한 캘린더의 일정 제목, 시작·종료 시각, 원본 링크와 일정 식별자를 읽습니다. 이 정보는 개인 일정 화면과 Mac 위젯에 표시하고 자동 동기화하는 데 사용합니다. Google 일정을 수정하거나 삭제하지 않으며, 일정을 할 일로 자동 변환하지 않습니다.</p>
      <p>자동 동기화에 필요한 연결 토큰은 서버에서 암호화하여 저장합니다. Mac 앱의 로그인 세션은 기기의 Keychain에 저장하며, 위젯 표시에 필요한 할 일과 일정 사본을 해당 Mac에 저장합니다.</p>
    </section>
    <section>
      <h2>표시 범위와 서비스 제공</h2>
      <p>할 일과 완료 상태는 daylight에 함께 초대된 사용자에게 표시됩니다. 할 일의 수정과 삭제는 작성자만 할 수 있습니다. Google 캘린더 일정, 프로젝트 기록과 첨부파일은 본인 화면에만 표시됩니다.</p>
      <p>Google은 로그인과 캘린더 연결을, Cloudflare는 서버 운영과 데이터 저장을 처리합니다. Google에서 받은 사용자 데이터를 판매하거나 광고에 사용하지 않으며, 범용 AI 모델 학습에 사용하지 않습니다. Google 사용자 데이터의 사용과 전송은 제한적 사용 요건을 포함한 <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API 서비스 사용자 데이터 정책</a>을 따릅니다.</p>
    </section>
    <section>
      <h2>연결 해제와 삭제</h2>
      <p>설정에서 자동 동기화를 해제하거나 <a href="https://myaccount.google.com/connections">Google 계정의 연결 관리</a>에서 접근 권한을 취소할 수 있습니다. 연결을 해제해도 이미 가져온 일정은 남습니다. 저장된 정보는 사용자가 삭제하거나 운영자에게 삭제를 요청할 때까지 보관합니다.</p>
      <p>할 일과 첨부파일은 앱의 삭제 기능을 사용할 수 있습니다. 계정, 캘린더 사본과 작업물 기록의 삭제는 아래 이메일로 요청할 수 있습니다.</p>
    </section>
    <section>
      <h2>문의</h2>
      <p>운영자: 김태현 · <a href="mailto:galaxycoreadvence@gmail.com">galaxycoreadvence@gmail.com</a></p>
    </section>
  </main>;
}
