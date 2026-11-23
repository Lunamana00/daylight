import AppIntents
import AppKit
import SwiftUI
import WidgetKit

struct DaylightWidgetOptions: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Dailog 표시 설정"
    @Parameter(title: "Google 일정 표시", default: true) var showCalendar: Bool
}

struct DaylightEntry: TimelineEntry {
    let date: Date
    let snapshot: DaylightSnapshot?
    var showCalendar = true
    var selectedDate: String? = nil
    var offsets: [String: Int] = [:]
    var calendarHour: Int? = nil
}

struct DaylightProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> DaylightEntry {
        let day = Daylight.dayKey()
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        let start = calendar.date(byAdding: .day, value: -((calendar.component(.weekday, from: .now) + 5) % 7), to: .now)!
        let tasks = [DaylightTask(id: "preview-1", title: "논문 초안 정리", done: false, parentTitle: "연구 발표")]
        let days = (0..<7).map { index in
            let date = Daylight.dayKey(calendar.date(byAdding: .day, value: index, to: start)!)
            return DaylightCalendarDay(date: date, tasks: date == day ? tasks : [], events: [])
        }
        return DaylightEntry(date: .now, snapshot: DaylightSnapshot(
            date: day, accountID: "", tasks: tasks, nextMilestone: nil, days: days
        ))
    }
    func snapshot(for configuration: DaylightWidgetOptions, in context: Context) async -> DaylightEntry {
        var current = context.isPreview ? placeholder(in: context) : entry()
        current.showCalendar = configuration.showCalendar
        return current
    }
    func timeline(for configuration: DaylightWidgetOptions, in context: Context) async -> Timeline<DaylightEntry> {
        var current = entry()
        current.showCalendar = configuration.showCalendar
        let tomorrow = DaylightEntry(date: Daylight.nextDay(after: current.date), snapshot: nil, showCalendar: configuration.showCalendar)
        return Timeline(entries: [current, tomorrow], policy: .after(current.date.addingTimeInterval(900)))
    }
    private func entry() -> DaylightEntry {
        let date = Date()
        let cached = DaylightCache.read()
        let snapshot = cached?.date == Daylight.dayKey(date) ? cached : nil
        return DaylightEntry(date: date, snapshot: snapshot, selectedDate: DaylightCache.selectedDate,
            offsets: Dictionary(uniqueKeysWithValues: (snapshot?.calendarDays ?? []).map { ($0.date, DaylightCache.offset(for: $0.date)) }), calendarHour: DaylightCache.calendarHour)
    }
}

struct DaylightWidgetView: View {
    let entry: DaylightEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode
    private var foreground: Color { renderingMode == .fullColor ? .primary : .white }
    private var wide: Bool { family == .systemExtraLarge }

    var body: some View {
        Group {
            if wide, let snapshot = entry.snapshot {
                DaylightFourDayCalendar(entry: entry, snapshot: snapshot, foreground: foreground)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 7) {
                        Image(systemName: "sun.max").widgetAccentable().accessibilityLabel("Dailog")
                        Text(Daylight.shortDate(Daylight.dayKey(entry.date))).font(.headline)
                        Spacer(minLength: 4)
                        Link(destination: Daylight.openCalendar) { Image(systemName: "arrow.up.left.and.arrow.down.right").frame(width: 22, height: 24) }
                            .accessibilityLabel("큰 달력에서 편집")
                        if let snapshot = entry.snapshot {
                            Text("오늘 \(snapshot.completed)/\(snapshot.total)").font(.system(size: 11, weight: .medium)).privacySensitive()
                        }
                        Button(intent: SyncDaylight()) {
                            Image(systemName: "arrow.clockwise").frame(width: 24, height: 24)
                        }.buttonStyle(.plain).accessibilityLabel("Dailog 동기화")
                    }
                    if let snapshot = entry.snapshot {
                        let days = Array(snapshot.calendarDays.prefix(7))
                        let selected = days.first(where: { $0.date == entry.selectedDate }) ?? days.first(where: { $0.date == snapshot.date }) ?? days[0]
                        HStack(spacing: 3) {
                            ForEach(days) { day in
                                dayHeader(day, today: snapshot.date, selected: selected.date).frame(maxWidth: .infinity)
                            }
                        }
                        DaylightAgenda(day: selected, snapshot: snapshot, showCalendar: entry.showCalendar,
                            offset: entry.offsets[selected.date] ?? 0, foreground: foreground)
                        if let message = snapshot.calendarMessage {
                            Link(message, destination: Daylight.openApp).font(.system(size: 11, weight: .medium))
                        }
                    } else {
                        Spacer(minLength: 0)
                        Link("Dailog 열기", destination: Daylight.openApp).font(.caption.weight(.semibold))
                        Spacer(minLength: 0)
                    }
                }
            }
        }
        .foregroundStyle(foreground)
        .containerBackground(for: .widget) { Rectangle().fill(.ultraThinMaterial) }
        .widgetURL(Daylight.openApp)
    }

    private func dayHeader(_ day: DaylightCalendarDay, today: String, selected: String) -> some View {
        Button(intent: SelectDaylightWidgetDay(day: day.date)) {
            VStack(spacing: 3) {
                Text(Daylight.weekday(day.date)).font(.system(size: 9, weight: .medium))
                Text(String(Int(day.date.suffix(2)) ?? 0)).font(.system(size: 12, weight: .semibold).monospacedDigit())
                    .frame(minWidth: 23, minHeight: 21)
                    .background(foreground.opacity(day.date == selected ? 0.17 : day.date == today ? 0.08 : 0), in: RoundedRectangle(cornerRadius: 6))
            }.frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(Daylight.shortDate(day.date)) \(day.tasks.count)개 할 일 보기")
    }
}

private struct DaylightFourDayCalendar: View {
    let entry: DaylightEntry
    let snapshot: DaylightSnapshot
    let foreground: Color

    private var days: [DaylightCalendarDay] {
        (0..<4).map { index in
            let date = Daylight.dayKey(entry.date.addingTimeInterval(Double(index) * 86_400))
            return snapshot.calendarDays.first(where: { $0.date == date }) ?? DaylightCalendarDay(date: date, tasks: [], events: [])
        }
    }
    private var hour: Int { entry.calendarHour ?? DaylightTimeGrid.initialHour(days: days, now: entry.date) }
    private func untimed(_ day: DaylightCalendarDay) -> DaylightCalendarDay {
        DaylightCalendarDay(date: day.date, tasks: day.tasks,
            events: entry.showCalendar ? day.events.filter { $0.startAt == nil } : [])
    }

    var body: some View {
        GeometryReader { geometry in
            let available = geometry.size.width - 36
            let unit = available / 4.7
            let hasUntimed = days.contains { !untimed($0).tasks.isEmpty || !untimed($0).events.isEmpty }
            let agendaHeight: CGFloat = hasUntimed ? min(geometry.size.height * 0.31,
                days.enumerated().map { index, day in
                    DaylightAgenda.naturalHeight(day: untimed(day), width: unit * (index == 0 ? 1.7 : 1))
                }.max() ?? 0) : 0
            VStack(spacing: 10) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(Array(days.enumerated()), id: \.element.id) { index, day in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(Daylight.weekday(day.date) + "요일").font(.system(size: 11, weight: .semibold))
                                    Text(String(Int(day.date.suffix(2)) ?? 0))
                                        .font(.system(size: index == 0 ? 38 : 21, weight: index == 0 ? .regular : .medium).monospacedDigit())
                                }
                                Spacer(minLength: 0)
                                if index == 0 {
                                    Text("오늘").font(.system(size: 10, weight: .semibold)).padding(.top, 2)
                                }
                            }.frame(height: 58, alignment: .top)
                            if hasUntimed {
                                let agenda = untimed(day)
                                if !agenda.tasks.isEmpty || !agenda.events.isEmpty {
                                    DaylightAgenda(day: agenda, snapshot: snapshot, showCalendar: entry.showCalendar,
                                        offset: entry.offsets[day.date] ?? 0, foreground: foreground)
                                        .frame(height: agendaHeight)
                                } else { Color.clear.frame(height: agendaHeight) }
                            }
                            DaylightHourColumn(day: day, hour: hour, now: entry.date, first: index == 0,
                                showCalendar: entry.showCalendar, foreground: foreground)
                        }.frame(width: unit * (index == 0 ? 1.7 : 1), alignment: .topLeading)
                    }
                }
                HStack(spacing: 6) {
                    if let message = snapshot.calendarMessage {
                        Link(destination: Daylight.openApp) {
                            Label(message, systemImage: "exclamationmark.circle")
                        }.lineLimit(1)
                    } else {
                        Text("오늘 \(snapshot.completed)/\(snapshot.total) 완료").privacySensitive()
                    }
                    Spacer(minLength: 4)
                    Link(destination: Daylight.openCalendar) { Image(systemName: "arrow.up.left.and.arrow.down.right").frame(width: 22, height: 22) }
                        .accessibilityLabel("큰 달력에서 편집")
                    if entry.showCalendar {
                        Button(intent: SelectDaylightCalendarHour(hour: hour - 3)) {
                            Image(systemName: "chevron.left").frame(width: 22, height: 22)
                        }.disabled(hour == 0).accessibilityLabel("이전 시간대")
                        Text("\(hour)–\(hour + 6)시").monospacedDigit()
                        Button(intent: SelectDaylightCalendarHour(hour: hour + 3)) {
                            Image(systemName: "chevron.right").frame(width: 22, height: 22)
                        }.disabled(hour == 18).accessibilityLabel("다음 시간대")
                    }
                    Button(intent: SyncDaylight()) {
                        Image(systemName: "arrow.clockwise").frame(width: 24, height: 22)
                    }.accessibilityLabel("Dailog 동기화")
                }.font(.system(size: 11, weight: .medium)).buttonStyle(.plain)
            }
        }
    }
}

private struct DaylightHourColumn: View {
    let day: DaylightCalendarDay
    let hour: Int
    let now: Date
    let first: Bool
    let showCalendar: Bool
    let foreground: Color

    var body: some View {
        GeometryReader { geometry in
            let gutter: CGFloat = first ? 27 : 0
            let height = max(1, geometry.size.height - 12)
            let width = max(1, geometry.size.width - gutter)
            let blocks = DaylightTimeGrid.blocks(showCalendar ? day.events : [], day: day.date,
                hour: hour, minimumMinutes: 52 / height * 360)
            ZStack(alignment: .topLeading) {
                ForEach(0..<7) { index in
                    HStack(spacing: 4) {
                        if first {
                            Text("\(hour + index)시").font(.system(size: 10, weight: .medium))
                                .frame(width: 23, alignment: .leading)
                        }
                        Rectangle().fill(foreground.opacity(0.12)).frame(height: 0.5)
                    }.frame(height: 12).offset(y: CGFloat(index) / 6 * height)
                }
                ForEach(blocks) { block in
                    let blockWidth = width / CGFloat(block.columns)
                    let blockHeight = max(1, CGFloat(block.end - block.start) / 360 * height - 2)
                    Link(destination: Daylight.openApp) {
                        HStack(alignment: .top, spacing: 5) {
                            RoundedRectangle(cornerRadius: 1.5).fill(foreground.opacity(0.85)).frame(width: 2)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(block.event.title).font(.system(size: 11, weight: .semibold))
                                    .lineLimit(max(1, Int((blockHeight - (blockHeight > 58 ? 26 : 10)) / 14))).fixedSize(horizontal: false, vertical: true)
                                if blockHeight > 58, let startAt = block.event.startAt, let start = DaylightTimeGrid.instant(startAt) {
                                    Text(start, format: Date.FormatStyle(date: .omitted, time: .shortened, locale: Locale(identifier: "ko_KR"), timeZone: TimeZone(identifier: "Asia/Seoul")!))
                                        .font(.system(size: 10, weight: .medium))
                                }
                            }.frame(maxWidth: .infinity, alignment: .topLeading)
                        }.padding(5).frame(width: max(1, blockWidth - 3), height: blockHeight, alignment: .topLeading)
                            .background(foreground.opacity(0.075), in: RoundedRectangle(cornerRadius: 4))
                    }
                    .buttonStyle(.plain).privacySensitive().help(block.event.title)
                    .accessibilityLabel("\(Daylight.shortDate(day.date)), \(block.event.title)")
                    .offset(x: gutter + CGFloat(block.column) * blockWidth, y: 6 + CGFloat(block.start - Double(hour * 60)) / 360 * height)
                }
                let minute = DaylightTimeGrid.minute(now, on: day.date)
                if first && minute >= Double(hour * 60) && minute <= Double((hour + 6) * 60) {
                    HStack(spacing: 0) {
                        Circle().frame(width: 5, height: 5)
                        Rectangle().frame(height: 1.5)
                    }.foregroundStyle(foreground).offset(y: 6 + minuteOffset(minute, height: height))
                        .accessibilityLabel("현재 시간")
                }
            }
        }
    }
    private func minuteOffset(_ minute: Double, height: CGFloat) -> CGFloat {
        CGFloat(minute - Double(hour * 60)) / 360 * height
    }
}

private enum DaylightAgendaItem: Identifiable {
    case task(DaylightTask), event(DaylightCalendarEvent)
    var id: String { switch self { case .task(let task): "task-" + task.id; case .event(let event): "event-" + event.id } }
    var title: String { switch self { case .task(let task): task.title; case .event(let event): event.title } }
    var context: String {
        switch self {
        case .task(let task):
            return [task.projectTitle, task.parentTitle == task.projectTitle ? nil : task.parentTitle].compactMap { $0 }.joined(separator: "\n")
        case .event(let event): return event.source ?? "Google Calendar"
        }
    }
    var projectColor: Color? {
        guard case .task(let task) = self, let hue = task.projectHue else { return nil }
        return Color(hue: hue / 360, saturation: (2 * 0.38) / (1 + 0.38), brightness: 0.43 * (1 + 0.38))
    }
}

private struct DaylightAgenda: View {
    let day: DaylightCalendarDay
    let snapshot: DaylightSnapshot
    let showCalendar: Bool
    let offset: Int
    let foreground: Color

    private var items: [DaylightAgendaItem] {
        day.tasks.map(DaylightAgendaItem.task) + (showCalendar ? day.events.map(DaylightAgendaItem.event) : [])
    }
    private static func textHeight(_ text: String, width: CGFloat, size: CGFloat, weight: NSFont.Weight) -> CGFloat {
        guard !text.isEmpty else { return 0 }
        return ceil((text as NSString).boundingRect(with: NSSize(width: max(16, width), height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: NSFont.systemFont(ofSize: size, weight: weight)]).height)
    }
    private static func rowHeight(_ item: DaylightAgendaItem, previous: DaylightAgendaItem?, width: CGFloat, font: CGFloat) -> CGFloat {
        let context = previous?.context == item.context ? "" : item.context
        return max(20, textHeight(item.title, width: width - 25, size: font, weight: .semibold))
            + (context.isEmpty ? 0 : textHeight(context, width: width - 33, size: max(11, font - 1), weight: .medium) + 4) + 8
    }
    static func naturalHeight(day: DaylightCalendarDay, width: CGFloat) -> CGFloat {
        let items = day.tasks.map(DaylightAgendaItem.task) + day.events.map(DaylightAgendaItem.event)
        guard !items.isEmpty else { return 0 }
        return items.indices.reduce(CGFloat(23)) { total, index in
            total + rowHeight(items[index], previous: index == 0 ? nil : items[index - 1], width: width, font: width < 150 ? 11 : 12)
        }
    }

    private func page(in size: CGSize) -> (start: Int, end: Int, font: CGFloat) {
        let start = offset < items.count ? offset : 0
        guard start < items.count else { return (0, 0, 12) }
        let available = max(20, size.height - 23)
        var font: CGFloat = size.width < 150 ? 11 : 12
        while font > 11 && Self.rowHeight(items[start], previous: nil, width: size.width, font: font) > available { font -= 0.5 }
        var used: CGFloat = 0, end = start
        for index in start..<items.count {
            let height = Self.rowHeight(items[index], previous: index == start ? nil : items[index - 1], width: size.width, font: font)
            if end > start && used + height > available { break }
            used += height; end = index + 1
        }
        return (start, end, font)
    }

    var body: some View {
        GeometryReader { geometry in
            let page = page(in: geometry.size)
            VStack(alignment: .leading, spacing: 0) {
                if items.isEmpty {
                    Text("일정 없음").font(.system(size: 10, weight: .medium)).padding(.top, 5)
                } else {
                    ForEach(page.start..<page.end, id: \.self) { index in
                        itemView(items[index], showContext: index == page.start || items[index - 1].context != items[index].context, font: page.font)
                            .padding(.bottom, 8)
                    }
                }
                Spacer(minLength: 0)
                if page.start > 0 || page.end < items.count {
                    HStack(spacing: 2) {
                        Button(intent: SelectDaylightWidgetDay(day: day.date, offset: max(0, page.start - max(1, page.end - page.start)))) {
                            Image(systemName: "chevron.left").frame(width: 18, height: 19)
                        }.disabled(page.start == 0).accessibilityLabel("이전 항목")
                        Spacer(minLength: 0)
                        Text("\(page.start + 1)–\(page.end)/\(items.count)").monospacedDigit()
                        Spacer(minLength: 0)
                        Button(intent: SelectDaylightWidgetDay(day: day.date, offset: page.end)) {
                            Image(systemName: "chevron.right").frame(width: 18, height: 19)
                        }.disabled(page.end == items.count).accessibilityLabel("다음 항목")
                    }.font(.system(size: 9, weight: .semibold)).buttonStyle(.plain)
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    @ViewBuilder
    private func itemView(_ item: DaylightAgendaItem, showContext: Bool, font: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if showContext && !item.context.isEmpty {
                HStack(alignment: .top, spacing: 4) {
                    if let color = item.projectColor {
                        Image(systemName: "circle.fill").widgetAccentedRenderingMode(.fullColor)
                            .font(.system(size: 5)).foregroundStyle(color).padding(.top, 3).accessibilityHidden(true)
                    }
                    Text(item.context).font(.system(size: max(11, font - 1), weight: .medium)).lineLimit(nil).fixedSize(horizontal: false, vertical: true)
                }.padding(.leading, 23)
            }
            switch item {
            case .task(let task):
                if day.date == snapshot.date {
                    Toggle(isOn: task.done, intent: SetDaylightTaskDone(task: task, snapshot: snapshot)) {
                        Text(task.title).strikethrough(task.done).lineLimit(nil).fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }.toggleStyle(DaylightCheckboxStyle()).disabled(snapshot.accountID.isEmpty)
                } else {
                    Link(destination: Daylight.openApp) {
                        HStack(alignment: .top, spacing: 5) {
                            Image(systemName: task.done ? "checkmark.square.fill" : "square").font(.system(size: 15, weight: .semibold)).frame(width: 18)
                            Text(task.title).strikethrough(task.done).lineLimit(nil).fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }.buttonStyle(.plain)
                }
            case .event(let event):
                HStack(alignment: .top, spacing: 5) {
                    Image(systemName: "calendar").font(.system(size: 12, weight: .medium)).frame(width: 18)
                    Text(event.title).lineLimit(nil).fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }.font(.system(size: font, weight: .semibold)).foregroundStyle(foreground).privacySensitive()
    }
}

private struct DaylightCheckboxStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(alignment: .top, spacing: 5) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .symbolRenderingMode(.monochrome).font(.system(size: 16, weight: .semibold))
                    .frame(width: 18, height: 18).accessibilityHidden(true)
                configuration.label
            }.frame(minHeight: 20).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityRepresentation { Toggle(isOn: configuration.$isOn) { configuration.label }.toggleStyle(.checkbox) }
    }
}

@main
struct DaylightWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Daylight.widgetKind, intent: DaylightWidgetOptions.self, provider: DaylightProvider()) { entry in
            DaylightWidgetView(entry: entry)
        }
        .configurationDisplayName("Dailog 주간 달력")
        .description("오늘부터 4일의 시간표와 할 일. 실제 일정 시간에 맞춰 표시합니다.")
        .supportedFamilies([.systemMedium, .systemLarge, .systemExtraLarge])
    }
}
