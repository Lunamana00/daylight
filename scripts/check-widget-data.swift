import Foundation

@main
struct CheckWidgetData {
    static func main() throws {
        let old = Data(#"{"date":"2026-11-12","accountID":"test","tasks":[{"id":"one","title":"제목 전체","done":false}],"nextMilestone":null}"#.utf8)
        let snapshot = try JSONDecoder().decode(DaylightSnapshot.self, from: old)
        precondition(snapshot.calendarDays.count == 1 && snapshot.calendarDays[0].date == "2026-11-12")
        precondition(snapshot.calendarDays[0].tasks[0].title == "제목 전체")
        let friday = DaylightCalendarDay(date: "2026-11-13", tasks: [], events: [DaylightCalendarEvent(id: "event", title: "내일 일정")])
        var updated = snapshot
        updated.days = snapshot.calendarDays + [friday]
        let restored = try JSONDecoder().decode(DaylightSnapshot.self, from: JSONEncoder().encode(updated))
        precondition(restored.calendarDays.count == 2 && restored.calendarDays[1].events[0].title == "내일 일정")
        updated.days = []
        precondition(updated.calendarDays.count == 1)
        precondition(Daylight.weekday("2026-11-12") == "목")
        precondition(Daylight.weekday("2026-11-13") == "금")
        print("Widget data checks passed: old cache, weekly data, empty-cache fallback and weekday labels.")
    }
}
