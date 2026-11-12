import AppIntents
import WidgetKit

struct SelectDaylightWidgetDay: AppIntent {
    static let title: LocalizedStringResource = "daylight 날짜 보기"
    static let isDiscoverable = false
    static var supportedModes: IntentModes { [.background, .foreground(.dynamic)] }

    @available(macOS 27.0, *)
    static var allowedExecutionTargets: IntentExecutionTargets { .main }

    @Parameter(title: "날짜") var day: String
    @Parameter(title: "시작 위치") var offset: Int

    init() {}
    init(day: String, offset: Int = 0) { self.day = day; self.offset = offset }

    @MainActor
    func perform() async throws -> IntentResultContainer<Never, Never, Never, Never> {
        guard let snapshot = DaylightCache.read(), snapshot.date == Daylight.dayKey(),
              let selected = snapshot.calendarDays.first(where: { $0.date == day }) else { throw DaylightError.stale }
        DaylightCache.select(day, offset: min(max(0, offset), max(0, selected.tasks.count + selected.events.count - 1)))
        WidgetCenter.shared.reloadTimelines(ofKind: Daylight.widgetKind)
        return .result()
    }
}

struct SyncDaylight: AppIntent {
    static let title: LocalizedStringResource = "daylight 동기화"
    static let isDiscoverable = false
    static var supportedModes: IntentModes { [.background, .foreground(.dynamic)] }

    @available(macOS 27.0, *)
    static var allowedExecutionTargets: IntentExecutionTargets { .main }

    @MainActor
    func perform() async throws -> IntentResultContainer<Never, Never, Never, Never> {
        #if DAYLIGHT_HOST
        try await PlannerConnection.shared.synchronize()
        return .result()
        #else
        throw DaylightError.signIn
        #endif
    }
}

struct SetDaylightTaskDone: AppIntent {
    static let title: LocalizedStringResource = "daylight 할 일 완료 상태 변경"
    static let isDiscoverable = false
    static var supportedModes: IntentModes { [.background, .foreground(.dynamic)] }

    @available(macOS 27.0, *)
    static var allowedExecutionTargets: IntentExecutionTargets { .main }

    @Parameter(title: "할 일") var taskID: String
    @Parameter(title: "완료") var done: Bool
    @Parameter(title: "날짜") var day: String
    @Parameter(title: "계정") var accountID: String

    init() {}

    init(task: DaylightTask, snapshot: DaylightSnapshot) {
        taskID = task.id
        done = !task.done
        day = snapshot.date
        accountID = snapshot.accountID
    }

    @MainActor
    func perform() async throws -> IntentResultContainer<Never, Never, Never, Never> {
        #if DAYLIGHT_HOST
        try await PlannerConnection.shared.setDone(taskID, done: done, day: day, accountID: accountID)
        return .result()
        #else
        throw DaylightError.signIn
        #endif
    }
}
