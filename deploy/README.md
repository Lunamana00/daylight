# Google login and the Mac widget

## Set up the Google server

1. Sign in to Wrangler with the Cloudflare account for daylight.
2. Create a D1 database for the Google deployment. Copy `wrangler.google.example.jsonc` to `wrangler.google.jsonc` in this directory.
3. Set the D1 database name and ID in the config. Set `DAYLIGHT_GOOGLE_ORIGIN` to the HTTPS origin of the new Worker. Use the origin without a trailing slash.
4. Create a **Web application** OAuth client in Google Cloud. Set its redirect URI to the Worker origin followed by `/auth/google/callback`.
5. Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `DAYLIGHT_GOOGLE_INVITES` as secrets for this Worker. Use `wrangler secret put NAME --config deploy/wrangler.google.jsonc`.

Use lowercase Google email addresses as keys in the invite JSON. Use an empty object for a new member. Set `memberId` to the member ID in an authorized data import to preserve the owner of existing tasks. Set `subject` to the Google account's stable subject if the email is outside Gmail and Google Workspace.

```json
{
  "new-member@gmail.com": {},
  "existing-member@gmail.com": {"memberId": "member-id-from-the-import"}
}
```

From the project root, use Node.js 24 or later. Apply the planner migrations to the new D1 database. Apply the Google login schema to the same database. Build and deploy the Worker.

```sh
npx wrangler d1 migrations apply DB --remote --config deploy/wrangler.google.jsonc
npx wrangler d1 execute DB --remote --file deploy/google-auth.sql --config deploy/wrangler.google.jsonc
npx wrangler d1 execute DB --remote --file deploy/google-calendar.sql --config deploy/wrangler.google.jsonc
npx wrangler d1 execute DB --remote --file deploy/google-calendar-auto.sql --config deploy/wrangler.google.jsonc
npx wrangler d1 execute DB --remote --file deploy/google-calendar-personal.sql --config deploy/wrangler.google.jsonc
npx wrangler d1 execute DB --remote --file deploy/google-invites.sql --config deploy/wrangler.google.jsonc
npm run build
npx wrangler deploy --config deploy/wrangler.google.jsonc
```

Apply `google-calendar-personal.sql` once to the Google database. It keeps tasks, events, and saved event order. Do not apply it to the original Sites database.

The **서로의 오늘** page shows each person’s tasks and completion state. Each person can change only their own tasks. **내 할 일** shows tasks first, then a weekly calendar with the signed-in person’s events, tasks, and dated subtasks. Select **월간** for the month view.

For a data transfer, import the authorized Sites records into the new schema with their original IDs. Set the invite map for the imported members.

## Invite people

Set the owner's row in `daylight_google_invites` to `role='admin'`. Set `member_id` to the owner's existing member ID. Keep the original `DAYLIGHT_GOOGLE_INVITES` secret for existing accounts and imported member mappings.

1. Sign in as the owner. Open **공유**.
2. Enter the person's Google email address. Select **초대 추가**.
3. Select **링크 복사** and send the link to that person.
4. The person must sign in with the invited Google account. Their name appears after they join.

Invitations are saved in D1. They apply to the web and Mac app. Only the owner can add invitations or read the invitation list. Each invitation binds to the Google account ID at its first successful sign-in. Email addresses must belong to Gmail or Google Workspace. The app does not send email.

Basic Google sign-in uses only `openid` and `email`. Calendar access has a separate consent flow. While the Google OAuth app is in Testing, a new person needs to be added to the Google test user list before they can connect their calendar.

To use daylight invitations without a separate Google test user list, publish the Google OAuth app as **In production**. Set its homepage to the Worker origin. Set its privacy policy to `/privacy` and its terms to `/terms` on the same origin. Review the public contact details before publication. The app still permits invited accounts only. Each person must consent to calendar access. Google can show an unverified-app warning and apply a 100-user limit until verification is complete.

## Connect personal calendars

1. Enable Google Calendar API in the Google Cloud project. If the OAuth app is in Testing, add the Google account as a test user.
2. Open **설정** in daylight. Select **Google 캘린더 선택**. Grant read access and background access in Google.
3. Select up to 20 calendars. Select **선택한 캘린더 자동 동기화** to import the next 90 days. Only your account can read these events in daylight.
4. The server updates the selected calendars every five minutes. Select **지금 동기화** on the web or the refresh button in the Mac widget for an immediate update.
5. Use **캘린더 선택·다시 연결** to change the selected calendars. Clear a checkbox or select **자동 동기화 해제** to stop updates for a calendar. Imported events remain in daylight. Only the account that connected a calendar can change its connection.

The server encrypts Google refresh tokens with a key derived from `GOOGLE_CLIENT_SECRET`. Keep that secret stable. If you change it, connect the calendars again. Failed calendar imports keep the last saved events. Daily tasks and the saved event order do not change during an import.

Google refresh tokens expire after seven days when the OAuth app is in Testing. Connect the calendars again when daylight shows **Google 다시 연결 필요**. Production OAuth configuration can require Google verification. The daylight account invite list controls access separately.

## Install the Mac widget

Use the [Mac installer and installation guide](../docs/mac-install.md) for the prebuilt app. This beta requires macOS 26 or later. Apple has not notarized it. A first launch can require approval in **System Settings > Privacy & Security**.

To build the app from source:

1. Install Xcode 26 or later. Open `macos/Daylight.xcodeproj` in Xcode.
2. Select the same Apple signing team for **Daylight** and **DaylightWidget**. Set `DAYLIGHT_SERVER_URL` in the **Daylight** build settings to the Google Worker origin.
3. Run **Daylight**. Select **Google로 로그인** and use an invited account.
4. Open **Edit Widgets** on the desktop. Add the medium **daylight** widget. Select **Clear** in the Mac appearance settings for the system glass style.

The widget shows up to four tasks scheduled for today. This includes dated subtasks. The header shows the completion count for all tasks scheduled for today. Right-click the widget and select **Edit Widget** to change **Google 일정 표시**. The Mac app holds the session in Keychain. A completion check runs in the Mac app and changes the same task on the Worker.

Open **작업물** and select a project. Select a color below its name, or select **자동** for its default color. Linked tasks and subtasks use this color in the web planner and Mac widget. The widget also shows the project name.

The refresh button runs in the Mac app and updates the connected calendars and daily tasks. The button does not write to Google Calendar. Calendar credentials stay on the server.

## Package the Mac beta

Use a valid Apple development signing identity for the configured team. The following command builds both Mac architectures. It disables debugger access in the release signature.

```sh
xcodebuild -project macos/Daylight.xcodeproj -scheme Daylight \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath outputs/macos-release \
  ARCHS='arm64 x86_64' ONLY_ACTIVE_ARCH=NO \
  ENABLE_HARDENED_RUNTIME=YES CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO build
```

Copy only `outputs/macos-release/Build/Products/Release/daylight.app` into the disk image. Use `ditto` to preserve the app bundle. Add a link to `/Applications` and the installation guide. Do not include local caches or login data. Upload the disk image and its SHA-256 checksum to a GitHub prerelease.

The app stores its session in the file-based Keychain. The widget receives display data through the app group. It does not receive the session. This beta does not require a device provisioning profile. An update from an older development build requires Google sign-in again.

A notarized release requires Developer ID signing and Apple notarization. See [Apple distribution signing](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac) and [Mac Keychain implementations](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains).
