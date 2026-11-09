import AppIntents

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
