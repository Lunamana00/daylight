import AppKit
import AuthenticationServices
import Combine
import CryptoKit
import Security
import WidgetKit

@MainActor
final class PlannerConnection: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = PlannerConnection()

    @Published private(set) var signedIn = false
    @Published private(set) var working = false
    @Published private(set) var status = ""

    let server = Daylight.server
    private var login: DaylightLogin?
    private var revision = 0
    private var authentication: ASWebAuthenticationSession?
    private var authenticationID: UUID?
    private var refreshTimer: Timer?
    private let network: URLSession

    private override init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 12
        configuration.timeoutIntervalForResource = 120
        network = URLSession(configuration: configuration, delegate: RejectRedirects(), delegateQueue: nil)
        super.init()
        login = server.flatMap { SessionVault.read(for: $0) }
        signedIn = login?.isActive == true
        status = server == nil ? "daylight 서버 주소를 설정해 주세요." : signedIn ? "동기화 중" : "Google 로그인 필요"
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 180, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
        WidgetCenter.shared.reloadTimelines(ofKind: Daylight.widgetKind)
    }

    func signIn() async {
        guard !working, let server else { return }
        working = true
        revision += 1
        defer { working = false }
        do {
            let verifier = try randomToken()
            let state = try randomToken()
            let challenge = base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
            var start = URLComponents(url: server.appending(path: "auth/google/start"), resolvingAgainstBaseURL: false)!
            start.queryItems = [
                URLQueryItem(name: "client", value: "mac"),
                URLQueryItem(name: "challenge", value: challenge),
                URLQueryItem(name: "state", value: state),
            ]
            guard let startURL = start.url else { throw DaylightError.server }
            let callback = try await authenticate(at: startURL)
            let parameters = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems
            guard callback.scheme == "daylight-mac", callback.host == "auth",
                  parameters?.first(where: { $0.name == "state" })?.value == state,
                  let code = parameters?.first(where: { $0.name == "code" })?.value else { throw DaylightError.signIn }

            let body = try JSONEncoder().encode(["code": code, "verifier": verifier])
            let data = try await request("auth/google/token", body: body)
            let newLogin = try JSONDecoder().decode(DaylightLogin.self, from: data)
            guard newLogin.isActive else { throw DaylightError.signIn }
            try SessionVault.write(newLogin, for: server)
            login = newLogin
            signedIn = true
            try publish(await snapshot(using: newLogin))
        } catch {
            show(error)
        }
    }

    func refresh() async {
        guard server != nil, !working else { return }
        revision += 1
        let started = revision
        do {
            let current = try await snapshot(using: activeLogin())
            if revision == started { try publish(current) }
        } catch {
            if revision == started { show(error) }
        }
    }

    func synchronize() async throws {
        guard !working else { throw DaylightError.busy }
        working = true
        revision += 1
        defer { working = false }
        do {
            let body = try JSONEncoder().encode(["op": "calendar.sync"])
            let data = try await request("api/planner", body: body, login: activeLogin(), timeout: 120)
            try publish(JSONDecoder().decode(DaylightSnapshot.self, from: data))
        } catch {
            if let login, let current = try? await snapshot(using: login) { try? publish(current) }
            show(error)
            throw error
        }
    }

    func setDone(_ taskID: String, done: Bool, day: String, accountID: String) async throws {
        guard !working else { throw DaylightError.busy }
        working = true
        revision += 1
        defer { working = false }
        do {
            let login = try activeLogin()
            let current = try await snapshot(using: login)
            guard current.date == day, current.accountID == accountID,
                  let task = current.tasks.first(where: { $0.id == taskID }) else {
                try publish(current)
                throw DaylightError.stale
            }
            let body = try JSONEncoder().encode(Completion(op: task.subtask == true ? "subtask.patch" : "task.patch", id: taskID, done: done, viewDate: day))
            let data = try await request("api/planner", body: body, login: login)
            try publish(JSONDecoder().decode(DaylightSnapshot.self, from: data))
        } catch {
            show(error)
            throw error
        }
    }

    func signOut() async {
        guard !working, let server else { return }
        working = true
        revision += 1
        defer { working = false }
        do {
            let previous = login
            try SessionVault.remove(for: server)
            forgetLogin()
            if let previous { _ = try? await request("auth/google/logout", body: Data(), login: previous) }
            status = "Google 로그인 필요"
        } catch {
            show(error)
        }
    }

    private struct Completion: Encodable {
        let op: String
        let id: String
        let done: Bool
        let viewDate: String
    }

    private func activeLogin() throws -> DaylightLogin {
        guard let login, login.isActive else { throw DaylightError.signIn }
        return login
    }

    private func snapshot(using login: DaylightLogin) async throws -> DaylightSnapshot {
        let data = try await request("api/planner", login: login)
        return try JSONDecoder().decode(DaylightSnapshot.self, from: data)
    }

    private func request(_ path: String, body: Data? = nil, login: DaylightLogin? = nil, timeout: TimeInterval = 20) async throws -> Data {
        guard let server else { throw DaylightError.server }
        var request = URLRequest(url: server.appending(path: path), cachePolicy: .reloadIgnoringLocalCacheData)
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let login { request.setValue("Bearer " + login.session, forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        let (data, response) = try await network.data(for: request)
        guard let status = (response as? HTTPURLResponse)?.statusCode else { throw DaylightError.unavailable }
        if status == 401 { throw DaylightError.signIn }
        if status == 409 { throw DaylightError.stale }
        if status == 428 { throw DaylightError.calendar }
        guard (200..<300).contains(status) else { throw DaylightError.unavailable }
        return data
    }

    private func publish(_ snapshot: DaylightSnapshot) throws {
        guard snapshot.date == Daylight.dayKey() else { throw DaylightError.stale }
        if DaylightCache.read() != snapshot {
            try DaylightCache.write(snapshot)
            WidgetCenter.shared.reloadTimelines(ofKind: Daylight.widgetKind)
        }
        status = "위젯 연결됨"
    }

    private func forgetLogin() {
        login = nil
        signedIn = false
        if DaylightCache.read() != nil {
            try? DaylightCache.clear()
            WidgetCenter.shared.reloadTimelines(ofKind: Daylight.widgetKind)
        }
    }

    private func show(_ error: Error) {
        if let failure = error as? DaylightError, case .signIn = failure {
            if login != nil, let server { try? SessionVault.remove(for: server) }
            forgetLogin()
        }
        if let cancellation = error as? ASWebAuthenticationSessionError, cancellation.code == .canceledLogin {
            status = "Google 로그인 필요"
        } else {
            status = (error as? DaylightError)?.errorDescription ?? "daylight에 연결하지 못했습니다."
        }
    }

    private func authenticate(at url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let id = UUID()
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "daylight-mac") { [weak self] callback, error in
                Task { @MainActor in
                    guard self?.authenticationID == id else { return }
                    self?.authenticationID = nil
                    self?.authentication = nil
                    if let callback { continuation.resume(returning: callback) }
                    else { continuation.resume(throwing: error ?? DaylightError.signIn) }
                }
            }
            authenticationID = id
            authentication = session
            session.presentationContextProvider = self
            if !session.start() {
                authenticationID = nil
                authentication = nil
                continuation.resume(throwing: DaylightError.unavailable)
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApplication.shared.keyWindow ?? NSApplication.shared.mainWindow ?? ASPresentationAnchor()
    }

    private func randomToken() throws -> String {
        var data = Data(count: 32)
        let result = data.withUnsafeMutableBytes {
            SecRandomCopyBytes(kSecRandomDefault, $0.count, $0.baseAddress!)
        }
        guard result == errSecSuccess else { throw DaylightError.unavailable }
        return base64url(data)
    }

    private func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

private final class RejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
