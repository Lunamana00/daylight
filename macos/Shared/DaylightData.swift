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

    static func weekday(_ day: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: day) else { return "" }
        formatter.dateFormat = "E"
        return formatter.string(from: date)
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

struct DaylightCalendarEvent: Codable, Equatable, Identifiable {
    let id: String
    let title: String
    var source: String? = nil
    var startAt: String? = nil
    var endAt: String? = nil

    func minutes(on day: String) -> (start: Double, end: Double)? {
        guard let startAt, let endAt, let start = DaylightTimeGrid.instant(startAt),
              let end = DaylightTimeGrid.instant(endAt), let midnight = DaylightTimeGrid.instant(day + "T00:00:00+09:00"),
              end > start else { return nil }
        let from = max(0, start.timeIntervalSince(midnight) / 60)
        let to = min(1440, end.timeIntervalSince(midnight) / 60)
        return to > from ? (from, to) : nil
    }
}

struct DaylightTimeBlock: Identifiable {
    let event: DaylightCalendarEvent
    let start: Double
    let end: Double
    var column = 0
    var columns = 1
    var id: String { event.id }
}

enum DaylightTimeGrid {
    static func instant(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    static func minute(_ date: Date, on day: String) -> Double {
        guard let midnight = instant(day + "T00:00:00+09:00") else { return 0 }
        return date.timeIntervalSince(midnight) / 60
    }

    static func initialHour(days: [DaylightCalendarDay], now: Date) -> Int {
        let today = Daylight.dayKey(now), current = minute(now, on: today)
        let starts = days.flatMap { day in
            day.events.compactMap { event -> Double? in
                guard let time = event.minutes(on: day.date), day.date > today || time.end > current else { return nil }
                return day.date == today ? max(current, time.start) : time.start
            }
        }
        return min(18, max(0, Int(min(current, starts.min() ?? current) / 60) - 1))
    }

    static func blocks(_ events: [DaylightCalendarEvent], day: String, hour: Int, minimumMinutes: Double) -> [DaylightTimeBlock] {
        let from = Double(hour * 60), to = from + 360
        var blocks = events.compactMap { event -> DaylightTimeBlock? in
            guard let time = event.minutes(on: day), time.end > from, time.start < to else { return nil }
            let start = max(from, time.start)
            return DaylightTimeBlock(event: event, start: start, end: min(to, max(time.end, start + minimumMinutes)))
        }.sorted { $0.start == $1.start ? $0.id < $1.id : $0.start < $1.start }
        var groupStart = 0, occupied: [Double] = []
        for index in blocks.indices {
            if !occupied.isEmpty && occupied.allSatisfy({ $0 <= blocks[index].start }) {
                for previous in groupStart..<index { blocks[previous].columns = occupied.count }
                groupStart = index; occupied = []
            }
            let column = occupied.firstIndex(where: { $0 <= blocks[index].start }) ?? occupied.count
            if column == occupied.count { occupied.append(blocks[index].end) } else { occupied[column] = blocks[index].end }
            blocks[index].column = column
        }
        for index in groupStart..<blocks.count { blocks[index].columns = occupied.count }
        return blocks
    }
}

struct DaylightCalendarDay: Codable, Equatable, Identifiable {
    let date: String
    let tasks: [DaylightTask]
    let events: [DaylightCalendarEvent]
    var id: String { date }
    var completed: Int { tasks.filter(\.done).count }
}

struct DaylightSnapshot: Codable, Equatable {
    let date: String
    let accountID: String
    let tasks: [DaylightTask]
    let nextMilestone: DaylightMilestone?
    var taskCount: Int? = nil
    var completedCount: Int? = nil
    var days: [DaylightCalendarDay]? = nil
    var calendarMessage: String? = nil

    var total: Int { taskCount ?? tasks.count }
    var completed: Int { completedCount ?? tasks.filter(\.done).count }
    var calendarDays: [DaylightCalendarDay] {
        if let days, !days.isEmpty { return days }
        return [DaylightCalendarDay(date: date, tasks: tasks, events: [])]
    }
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
    private static var preferences: UserDefaults? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "DaylightAppGroup") as? String,
              !group.isEmpty else { return nil }
        return UserDefaults(suiteName: group)
    }

    static var selectedDate: String? { preferences?.string(forKey: "widget.selectedDate") }
    static var calendarHour: Int? {
        guard preferences?.string(forKey: "widget.hourDay") == Daylight.dayKey(),
              let hour = preferences?.object(forKey: "widget.hour") as? Int else { return nil }
        return min(18, max(0, hour))
    }
    static func selectHour(_ hour: Int) {
        preferences?.set(Daylight.dayKey(), forKey: "widget.hourDay")
        preferences?.set(min(18, max(0, hour)), forKey: "widget.hour")
    }
    static func offset(for day: String) -> Int { max(0, preferences?.integer(forKey: "widget.offset.\(day)") ?? 0) }
    static func select(_ day: String, offset: Int) {
        preferences?.set(day, forKey: "widget.selectedDate")
        preferences?.set(max(0, offset), forKey: "widget.offset.\(day)")
    }

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
