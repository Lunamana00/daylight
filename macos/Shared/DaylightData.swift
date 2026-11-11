import Foundation

enum Daylight {
    static let openApp = URL(string: "daylight-mac://planner")!
    static let widgetKind = "DaylightPlanner"

    static var server: URL? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "DaylightServerURL") as? String,
              let url = URLComponents(string: value),
              url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else { return nil }
        return url.url
    }

    static func dayKey(_ date: Date = .now) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    static func shortDate(_ day: String) -> String {
        day.split(separator: "-").dropFirst().compactMap { Int($0) }.map(String.init).joined(separator: ".")
    }

    static func nextDay(after date: Date) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        return calendar.dateInterval(of: .day, for: date)?.end ?? date.addingTimeInterval(86_400)
    }
}

struct DaylightTask: Codable, Equatable, Identifiable {
    let id: String
    let title: String
    let done: Bool
    var parentTitle: String? = nil
    var subtask: Bool? = nil
    var projectTitle: String? = nil
    var projectHue: Double? = nil
}

struct DaylightMilestone: Codable, Equatable {
    let title: String
    let date: String
}

struct DaylightSnapshot: Codable, Equatable {
    let date: String
    let accountID: String
    let tasks: [DaylightTask]
    let nextMilestone: DaylightMilestone?
    var taskCount: Int? = nil
    var completedCount: Int? = nil

    var total: Int { taskCount ?? tasks.count }
    var completed: Int { completedCount ?? tasks.filter(\.done).count }
}

enum DaylightError: LocalizedError {
    case signIn, unavailable, stale, busy, appGroup, server, keychain, calendar

    var errorDescription: String? {
        switch self {
        case .signIn: "Google 계정으로 로그인해 주세요."
        case .unavailable: "daylight에 연결하지 못했습니다."
        case .stale: "할 일 목록이 바뀌었습니다. 위젯을 다시 확인해 주세요."
        case .busy: "동기화 중입니다. 잠시 후 다시 시도해 주세요."
        case .appGroup: "앱과 위젯의 공유 저장소를 열 수 없습니다."
        case .server: "daylight 서버 주소를 설정해 주세요."
        case .keychain: "Mac 키체인에 로그인 정보를 저장할 수 없습니다."
        case .calendar: "웹에서 Google 캘린더를 다시 연결해 주세요."
        }
    }
}

enum DaylightCache {
    private static var file: URL? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "DaylightAppGroup") as? String,
              !group.isEmpty else { return nil }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appendingPathComponent("daylight-widget.json")
    }

    static func read() -> DaylightSnapshot? {
        guard let file, let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(DaylightSnapshot.self, from: data)
    }

    static func write(_ snapshot: DaylightSnapshot) throws {
        guard let file else { throw DaylightError.appGroup }
        try JSONEncoder().encode(snapshot).write(to: file, options: .atomic)
    }

    static func clear() throws {
        guard let file else { throw DaylightError.appGroup }
        do {
            try FileManager.default.removeItem(at: file)
        } catch let error as CocoaError where error.code == .fileNoSuchFile {
            // A new installation has no cached account data.
        }
    }
}
