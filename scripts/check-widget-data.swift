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
        let events = [
            DaylightCalendarEvent(id: "early", title: "Overnight", startAt: "2026-11-19T23:00:00+09:00", endAt: "2026-11-20T01:00:00+09:00"),
            DaylightCalendarEvent(id: "a", title: "A", startAt: "2026-11-20T15:00:00+09:00", endAt: "2026-11-20T17:00:00+09:00"),
            DaylightCalendarEvent(id: "b", title: "B", startAt: "2026-11-20T15:30:00+09:00", endAt: "2026-11-20T16:00:00+09:00"),
            DaylightCalendarEvent(id: "c", title: "C", startAt: "2026-11-20T18:00:00+09:00", endAt: "2026-11-20T19:00:00+09:00"),
        ]
        precondition(events[0].minutes(on: "2026-11-20")!.start == 0)
        precondition(events[0].minutes(on: "2026-11-20")!.end == 60)
        precondition(events[0].minutes(on: "2026-11-21") == nil)
        let blocks = DaylightTimeGrid.blocks(events, day: "2026-11-20", hour: 14, minimumMinutes: 30)
        precondition(blocks.count == 3 && blocks[0].columns == 2 && blocks[1].columns == 2)
        precondition(blocks[0].column != blocks[1].column && blocks[2].columns == 1)
        precondition(DaylightTimeGrid.blocks(events, day: "2026-11-20", hour: 0, minimumMinutes: 30).count == 1)
        let late = DaylightTimeGrid.instant("2026-11-20T23:45:00+09:00")!
        precondition(DaylightTimeGrid.windowStart(late) == 1200)
        let afternoon = DaylightTimeGrid.instant("2026-11-20T17:17:00+09:00")!
        precondition(DaylightTimeGrid.windowStart(afternoon) == 990)
        precondition(DaylightTimeGrid.initialHour(days: [friday], now: afternoon) == 17)
        precondition(DaylightTimeGrid.snappedMinute(1038) == 1035)
        precondition(DaylightTimeGrid.snappedMinute(1450) == 1425)
        let allDay = DaylightCalendarEvent(id: "all", title: "All day", date: "2026-11-20", endDate: "2026-11-21")
        precondition(allDay.moveStart == "2026-11-20" && allDay.moveEnd == "2026-11-22")
        print("Widget data checks passed: old cache, weekly data, empty-cache fallback and weekday labels.")
    }
}
