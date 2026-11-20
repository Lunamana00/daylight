import SwiftUI

@main
struct DaylightApp: App {
    @StateObject private var connection = PlannerConnection.shared

    var body: some Scene {
        Window("daylight", id: "calendar") {
            DesktopCalendarView(connection: connection)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1120, height: 700)
        .windowResizability(.contentMinSize)
    }
}
