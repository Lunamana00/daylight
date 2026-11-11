import AppIntents
import SwiftUI
import WidgetKit

struct DaylightWidgetOptions: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "daylight 표시 설정"

    @Parameter(title: "Google 일정 표시", default: true)
    var showCalendar: Bool
}

struct DaylightEntry: TimelineEntry {
    let date: Date
    let snapshot: DaylightSnapshot?
    var showCalendar = true
}

struct DaylightProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> DaylightEntry {
        let day = Daylight.dayKey()
        return DaylightEntry(date: .now, snapshot: DaylightSnapshot(
            date: day, accountID: "",
            tasks: [DaylightTask(id: "preview-1", title: "할 일", done: false),
                    DaylightTask(id: "preview-2", title: "완료한 할 일", done: true)],
            nextMilestone: DaylightMilestone(title: "내 일정", date: day)
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
        let snapshot = DaylightCache.read()
        return DaylightEntry(date: date, snapshot: snapshot?.date == Daylight.dayKey(date) ? snapshot : nil)
    }
}

struct DaylightWidgetView: View {
    let entry: DaylightEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Image(systemName: "sun.max").widgetAccentable().accessibilityLabel("daylight")
                Text(Daylight.shortDate(Daylight.dayKey(entry.date))).font(.headline.monospacedDigit())
                Spacer()
                if let snapshot = entry.snapshot {
                    Text("\(snapshot.completed)/\(snapshot.total) 완료")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        .privacySensitive()
                }
                Button(intent: SyncDaylight()) {
                    Image(systemName: "arrow.clockwise").font(.caption).frame(width: 26, height: 24)
                }
                .buttonStyle(.plain).accessibilityLabel("daylight 동기화").help("캘린더와 할 일 동기화")
            }

            if let snapshot = entry.snapshot {
                if snapshot.tasks.isEmpty {
                    Text("오늘 할 일 없음").font(.caption).foregroundStyle(.secondary)
                } else {
                    ForEach(snapshot.tasks) { task in
                        // Match the web's HSL accent (38%, 43%) using SwiftUI's HSB initializer.
                        let projectColor = task.projectHue.map {
                            Color(hue: $0 / 360, saturation: (2 * 0.38) / (1 + 0.38), brightness: 0.43 * (1 + 0.38))
                        } ?? Color.secondary
                        Toggle(isOn: task.done, intent: SetDaylightTaskDone(task: task, snapshot: snapshot)) {
                            HStack(spacing: 6) {
                                Text((task.parentTitle.map { "\($0) · " } ?? "") + task.title)
                                    .lineLimit(1).strikethrough(task.done)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                if let project = task.projectTitle {
                                    HStack(spacing: 4) {
                                        Image(systemName: "circle.fill")
                                            .symbolRenderingMode(.palette)
                                            .widgetAccentedRenderingMode(.fullColor)
                                            .font(.system(size: 6))
                                            .accessibilityHidden(true)
                                        Text(project).lineLimit(1)
                                    }
                                    .font(.system(size: 9, weight: .medium))
                                    .foregroundStyle(projectColor)
                                    .frame(maxWidth: 88, alignment: .trailing)
                                    .help(project)
                                    .accessibilityLabel("프로젝트 \(project)")
                                }
                            }
                        }
                        .toggleStyle(.checkbox).font(.caption).privacySensitive()
                        .tint(projectColor)
                        .disabled(snapshot.accountID.isEmpty)
                    }
                }
                Spacer(minLength: 0)
                HStack(spacing: 5) {
                    if entry.showCalendar, let milestone = snapshot.nextMilestone {
                        Label("\(Daylight.shortDate(milestone.date))  \(milestone.title)", systemImage: "calendar")
                            .lineLimit(1).privacySensitive()
                    }
                    Spacer(minLength: 0)
                    if snapshot.total > snapshot.tasks.count {
                        Link("+\(snapshot.total - snapshot.tasks.count)", destination: Daylight.openApp)
                            .accessibilityLabel("나머지 할 일 \(snapshot.total - snapshot.tasks.count)개 열기")
                    }
                }.font(.caption2).foregroundStyle(.secondary)
            } else {
                Spacer(minLength: 0)
                Link("daylight 열기", destination: Daylight.openApp).font(.caption)
                Spacer(minLength: 0)
            }
        }
        .containerBackground(for: .widget) { Rectangle().fill(.ultraThinMaterial) }
        .widgetURL(Daylight.openApp)
    }
}

@main
struct DaylightWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Daylight.widgetKind, intent: DaylightWidgetOptions.self, provider: DaylightProvider()) { entry in
            DaylightWidgetView(entry: entry)
        }
        .configurationDisplayName("daylight")
        .description("오늘 할 일과 완료 상태")
        .supportedFamilies([.systemMedium])
    }
}
