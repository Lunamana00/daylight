import AppKit
import SwiftUI

struct DesktopCalendarView: View {
    @ObservedObject var connection: PlannerConnection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var now = Date()
    @State private var manualMinute: Double?
    @State private var flow = true
    @State private var taskDrag: TaskDrag?
    @State private var eventDrag: EventDrag?
    @State private var frames: [CalendarFrame] = []
    private let clock = Timer.publish(every: 30, on: .main, in: .common).autoconnect()
    private var startMinute: Double { manualMinute ?? DaylightTimeGrid.windowStart(now) }
    private var dragging: Bool { taskDrag != nil || eventDrag != nil }
    private var days: [DaylightCalendarDay] {
        (0..<4).map { offset in
            let date = Daylight.dayKey(now.addingTimeInterval(Double(offset) * 86_400))
            return connection.plan?.calendarDays.first(where: { $0.date == date }) ?? DaylightCalendarDay(date: date, tasks: [], events: [])
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            if connection.signedIn {
                GeometryReader { geometry in
                    let width = max(0, geometry.size.width - 40)
                    let unit = width / 4.65
                    let agendaHeight = min(180, max(80, geometry.size.height * 0.3))
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(Array(days.enumerated()), id: \.element.date) { index, day in
                            dayColumn(day, today: index == 0, agendaHeight: agendaHeight)
                                .frame(width: unit * (index == 0 ? 1.65 : 1))
                                .overlay(alignment: .leading) { if index > 0 { Divider().opacity(0.4) } }
                        }
                    }
                    .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 12)
                }
            } else {
                VStack(spacing: 18) {
                    Image(systemName: "sun.max").font(.system(size: 42, weight: .light))
                    Text("하루가 한눈에, daylight").font(.title2.weight(.medium))
                    Text("할 일과 Google 일정을 큰 달력에서 정리하세요.").foregroundStyle(.secondary)
                    Button("Google로 로그인") { Task { await connection.signIn() } }
                        .buttonStyle(.borderedProminent).disabled(connection.working)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            footer
        }
        .coordinateSpace(name: "calendar")
        .preferredColorScheme(.dark)
        .foregroundStyle(.white)
        .tint(.white)
        .clipShape(RoundedRectangle(cornerRadius: 28))
        .onPreferenceChange(CalendarFrames.self) { frames = $0 }
        .overlay(alignment: .topLeading) {
            if let drag = taskDrag {
                HStack(spacing: 9) {
                    Image(systemName: drag.task.done ? "checkmark.square.fill" : "square")
                    Text(drag.task.title).lineLimit(1)
                }
                .font(.system(size: 14, weight: .medium)).padding(12)
                .frame(width: 310, alignment: .leading)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.blue.opacity(0.35)))
                .shadow(color: .black.opacity(0.15), radius: 16, y: 8)
                .offset(x: max(8, drag.point.x - 35), y: max(8, drag.point.y - 18))
                .allowsHitTesting(false)
            }
        }
        .frame(minWidth: 720, minHeight: 360)
        .task { await connection.refresh() }
        .onReceive(clock) { date in
            let changedDay = Daylight.dayKey(date) != Daylight.dayKey(now)
            now = date
            if changedDay { manualMinute = nil; Task { await connection.refresh() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            now = Date(); Task { await connection.refresh() }
        }
        .onExitCommand { taskDrag = nil; eventDrag = nil }
    }

    private var footer: some View {
        HStack(spacing: 10) {
            if connection.working { ProgressView().controlSize(.mini) }
            if connection.failed { Text(connection.status).lineLimit(1) }
            else if dragging { Text("놓아서 이동 · Esc 취소").lineLimit(1) }
            else if let plan = connection.plan { Text("오늘 \(plan.completed)/\(plan.total) 완료") }
            Spacer(minLength: 10)
            Image(systemName: "arrow.up.and.down.and.arrow.left.and.right").frame(width: 22, height: 22)
                .overlay(DesktopWidgetHandle()).help("위젯 위치 이동")
            Button { flow.toggle() } label: { Image(systemName: flow ? "pause" : "play") }
                .help(flow ? "글자 흐름 일시 정지" : "글자 흐름 재생")
            Button { manualMinute = max(0, startMinute - 60) } label: { Image(systemName: "chevron.left") }
                .disabled(startMinute <= 0).help("한 시간 이전 보기")
            Button("지금") { now = Date(); manualMinute = nil }.keyboardShortcut("0", modifiers: .command)
                .help("현재 시간으로 이동")
            Button { manualMinute = min(1200, startMinute + 60) } label: { Image(systemName: "chevron.right") }
                .disabled(startMinute >= 1200).help("한 시간 이후 보기")
            Button { Task { try? await connection.synchronize() } } label: { Image(systemName: "arrow.clockwise") }
                .disabled(connection.working || !connection.signedIn).help("동기화")
            Menu {
                if let server = connection.server {
                    Button("웹에서 열기") { NSWorkspace.shared.open(server) }
                    Button("Google 일정 이동 연결…") { NSWorkspace.shared.open(server.appending(path: "calendar/edit")) }
                }
                Divider()
                Button("로그아웃") { Task { await connection.signOut() } }.disabled(connection.working || !connection.signedIn)
            } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).frame(width: 18).help("연결 및 계정")
            Image(systemName: "arrow.up.left.and.arrow.down.right").frame(width: 22, height: 22)
                .overlay(DesktopWidgetHandle(resize: true)).help("끌어서 위젯 크기 조절")
        }
        .font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.85)).buttonStyle(.plain)
        .padding(.horizontal, 24).padding(.bottom, 12).padding(.top, 3)
    }

    private func dayColumn(_ day: DaylightCalendarDay, today: Bool, agendaHeight: Double) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(Daylight.weekday(day.date) + "요일").font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
                    Text(String(Int(day.date.suffix(2)) ?? 0)).font(.system(size: today ? 40 : 27, weight: .regular, design: .rounded))
                }
                Spacer()
                if today { Text("오늘").font(.system(size: 11, weight: .medium)).foregroundStyle(.white).padding(.top, 2) }
            }.frame(height: 68, alignment: .top)
                .background(DesktopWidgetHandle())
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(day.tasks) { task in taskRow(task, day: day) }
                    ForEach(day.events.filter { $0.startAt == nil }) { event in
                        eventCard(event, subtitle: "종일", active: eventDrag?.event.id == event.id)
                            .frame(height: 37).contentShape(Rectangle())
                            .gesture(eventGesture(event, day: day.date, allDay: true))
                            .contextMenu { eventMenu(event) }
                    }
                    if day.tasks.isEmpty && day.events.allSatisfy({ $0.startAt != nil }) {
                        Text("예정된 할 일 없음").font(.system(size: 12)).foregroundStyle(.white.opacity(0.55)).padding(.top, 5)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.trailing, 4)
            }
            .scrollIndicators(.hidden).frame(height: agendaHeight)
            .background(frameReader(id: "agenda", day: day.date))
            .overlay(alignment: .bottom) {
                if eventDrag?.allDay == true && eventDrag?.day == day.date { RoundedRectangle(cornerRadius: 5).strokeBorder(.blue, style: StrokeStyle(lineWidth: 1.5, dash: [5])).frame(height: 34) }
            }
            Divider().opacity(0.4).padding(.bottom, 14)
            timeGrid(day, today: today)
        }.padding(.horizontal, 14)
    }

    private func taskRow(_ task: DaylightTask, day: DaylightCalendarDay) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "line.3.horizontal").font(.system(size: 10, weight: .medium))
                .foregroundStyle(.white.opacity(0.55)).frame(width: 14, height: 30).contentShape(Rectangle())
                .gesture(taskGesture(task, day: day)).help("드래그해서 순서 변경")
                .accessibilityLabel("\(task.title) 순서 변경")
                .focusable()
                .onKeyPress(.upArrow) { moveTask(task, day: day, forward: false); return .handled }
                .onKeyPress(.downArrow) { moveTask(task, day: day, forward: true); return .handled }
            Button { if let plan = connection.plan { Task { try? await connection.setDone(task.id, done: !task.done, day: day.date, accountID: plan.accountID) } } } label: {
                Image(systemName: task.done ? "checkmark.square.fill" : "square")
                    .font(.system(size: 20, weight: .medium)).foregroundStyle(task.done ? Color.white : Color.white.opacity(0.9))
            }.buttonStyle(.plain).disabled(connection.working).accessibilityLabel(task.title + (task.done ? " 완료 취소" : " 완료"))
            VStack(alignment: .leading, spacing: 2) {
                if let project = task.projectTitle ?? task.parentTitle {
                    HStack(spacing: 4) {
                        if task.projectTitle != nil { Circle().fill(Color(hue: (task.projectHue ?? 218) / 360, saturation: 0.5, brightness: 0.8)).frame(width: 5, height: 5) }
                        Text(project).font(.system(size: 10, weight: .medium)).lineLimit(1).foregroundStyle(.secondary).help(project)
                    }
                }
                FlowTitle(text: task.title, size: 14, done: task.done, paused: !flow || dragging || reduceMotion)
                    .foregroundStyle(task.done ? .secondary : .primary).frame(height: 20)
            }
        }
        .padding(.vertical, 5).padding(.horizontal, 2)
        .opacity(taskDrag?.task.id == task.id ? 0.25 : 1)
        .background(frameReader(id: task.id, day: day.date, done: task.done))
        .overlay(alignment: .top) { if taskDrag?.target == task.id && taskDrag?.after == false { Capsule().fill(.blue).frame(height: 2) } }
        .overlay(alignment: .bottom) { if taskDrag?.target == task.id && taskDrag?.after == true { Capsule().fill(.blue).frame(height: 2) } }
        .contextMenu {
            Button("위로 이동") { moveTask(task, day: day, forward: false) }.disabled(!canMoveTask(task, day: day, forward: false))
            Button("아래로 이동") { moveTask(task, day: day, forward: true) }.disabled(!canMoveTask(task, day: day, forward: true))
        }
        .accessibilityAction(named: "위로 이동") { moveTask(task, day: day, forward: false) }
        .accessibilityAction(named: "아래로 이동") { moveTask(task, day: day, forward: true) }
    }

    private func timeGrid(_ day: DaylightCalendarDay, today: Bool) -> some View {
        GeometryReader { geometry in
            let scale = max(1, geometry.size.height) / 240
            let inset: Double = 33
            let blocks = DaylightTimeGrid.blocks(day.events, day: day.date, hour: 0, minimumMinutes: max(25, 34 / scale), fromMinute: startMinute, duration: 240)
            ZStack(alignment: .topLeading) {
                ForEach(Array(stride(from: ceil(startMinute / 60) * 60, through: min(1440, startMinute + 240), by: 60)), id: \.self) { minute in
                    HStack(spacing: 6) {
                        Text(timeLabel(minute)).font(.system(size: 10)).monospacedDigit().foregroundStyle(.white.opacity(0.55)).frame(width: 30, alignment: .leading)
                        Rectangle().fill(.white.opacity(0.12)).frame(height: 0.5)
                    }.offset(y: (minute - startMinute) * scale - 6)
                }
                ForEach(blocks) { block in
                    let laneWidth = max(1, geometry.size.width - inset) / Double(block.columns)
                    eventCard(block.event, subtitle: eventTime(block.event), active: eventDrag?.event.id == block.id)
                        .frame(width: max(1, laneWidth - 4), height: max(30, (block.end - block.start) * scale - 3))
                        .contentShape(Rectangle()).gesture(eventGesture(block.event, day: day.date, allDay: false))
                        .contextMenu { eventMenu(block.event) }
                        .offset(x: inset + Double(block.column) * laneWidth, y: (block.start - startMinute) * scale)
                }
                if let drag = eventDrag, !drag.allDay && drag.day == day.date {
                    let top = max(startMinute, drag.minute), end = min(startMinute + 240, drag.minute + drag.duration)
                    if end > top {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(drag.event.title).lineLimit(1)
                            Text(timeLabel(drag.minute)).monospacedDigit()
                        }.font(.system(size: 12, weight: .medium)).padding(8)
                            .frame(width: max(1, geometry.size.width - inset - 3), height: max(25, (end - top) * scale), alignment: .topLeading)
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 7))
                            .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(.blue, style: StrokeStyle(lineWidth: 1.5, dash: [5])))
                            .foregroundStyle(.blue).offset(x: inset, y: (top - startMinute) * scale).allowsHitTesting(false)
                    }
                }
                let current = DaylightTimeGrid.minute(now, on: day.date)
                if today && current >= startMinute && current <= startMinute + 240 {
                    HStack(spacing: 0) { Circle().fill(.white).frame(width: 5, height: 5); Rectangle().fill(.white.opacity(0.85)).frame(height: 1) }
                        .offset(y: (current - startMinute) * scale - 2).allowsHitTesting(false)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(frameReader(id: "grid", day: day.date))
            .clipped()
        }
    }

    private func eventCard(_ event: DaylightCalendarEvent, subtitle: String, active: Bool) -> some View {
        GeometryReader { geometry in
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 2).fill(.white.opacity(0.9)).frame(width: 3)
                VStack(alignment: .leading, spacing: 3) {
                    FlowTitle(text: event.title, size: 12, paused: !flow || dragging || reduceMotion).frame(height: 17)
                    if geometry.size.height >= 40 {
                        Text(subtitle).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }.padding(.horizontal, 8).padding(.vertical, 6)
            }
        }
        .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.white.opacity(0.08)))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .opacity(active ? 0.25 : 1).help(event.title + " · " + subtitle + (event.canEdit == true ? " · 드래그로 이동" : " · 읽기 전용"))
        .accessibilityLabel(event.title + ", " + subtitle)
    }

    private func taskGesture(_ task: DaylightTask, day: DaylightCalendarDay) -> some Gesture {
        DragGesture(minimumDistance: 5, coordinateSpace: .named("calendar"))
            .onChanged { value in
                guard !connection.working else { return }
                let area = frames.first { $0.id == "agenda" && $0.day == day.date }?.rect
                let targets = frames.filter { $0.day == day.date && $0.id != task.id && $0.id != "grid" && $0.id != "agenda" && $0.done == task.done && area?.intersects($0.rect) == true }
                let target = area?.contains(value.location) == true ? targets.min(by: { abs($0.rect.midY - value.location.y) < abs($1.rect.midY - value.location.y) }) : nil
                taskDrag = TaskDrag(task: task, day: day.date, point: value.location, target: target?.id, after: value.location.y > (target?.rect.midY ?? 0))
            }.onEnded { _ in
                defer { taskDrag = nil }
                guard let drag = taskDrag, let target = drag.target, let plan = connection.plan else { return }
                Task { await connection.moveTask(task, to: target, after: drag.after, day: drag.day, accountID: plan.accountID) }
            }
    }

    private func eventGesture(_ event: DaylightCalendarEvent, day: String, allDay: Bool) -> some Gesture {
        DragGesture(minimumDistance: 5, coordinateSpace: .named("calendar"))
            .onChanged { value in
                guard !connection.working, event.canEdit == true,
                      let original = frames.first(where: { $0.id == (allDay ? "agenda" : "grid") && $0.day == day }),
                      let target = frames.first(where: { $0.id == (allDay ? "agenda" : "grid") && $0.rect.contains(value.location) }) else { eventDrag = nil; return }
                let originalTime = event.startAt.flatMap(DaylightTimeGrid.instant)
                let originalMinute = originalTime.map { DaylightTimeGrid.minute($0, on: day) } ?? 0
                let offset = (value.startLocation.y - original.rect.minY) / original.rect.height * 240 + startMinute - originalMinute
                let minute = allDay ? 0 : DaylightTimeGrid.snappedMinute((value.location.y - target.rect.minY) / target.rect.height * 240 + startMinute - offset)
                let duration = event.endAt.flatMap(DaylightTimeGrid.instant).flatMap { end in originalTime.map { end.timeIntervalSince($0) / 60 } } ?? 0
                eventDrag = EventDrag(event: event, day: target.day, minute: minute, duration: duration, allDay: allDay)
            }.onEnded { _ in
                defer { eventDrag = nil }
                guard let drag = eventDrag, let plan = connection.plan,
                      let midnight = DaylightTimeGrid.instant(drag.day + "T00:00:00+09:00") else { return }
                let start = drag.allDay ? drag.day : ISO8601DateFormatter().string(from: midnight.addingTimeInterval(drag.minute * 60))
                Task { await connection.moveEvent(event, to: start, accountID: plan.accountID) }
            }
    }

    @ViewBuilder private func eventMenu(_ event: DaylightCalendarEvent) -> some View {
        if event.canEdit == true {
            if event.startAt != nil {
                Button("15분 앞당기기") { shiftEvent(event, seconds: -900) }
                Button("15분 늦추기") { shiftEvent(event, seconds: 900) }
            }
            Button("하루 앞당기기") { shiftEvent(event, seconds: -86_400) }
            Button("하루 늦추기") { shiftEvent(event, seconds: 86_400) }
        } else if let server = connection.server {
            Button("Google 일정 이동 연결…") { NSWorkspace.shared.open(server.appending(path: "calendar/edit")) }
        }
    }

    private func shiftEvent(_ event: DaylightCalendarEvent, seconds: Double) {
        guard let source = event.moveStart, let date = DaylightTimeGrid.instant(source.count == 10 ? source + "T00:00:00+09:00" : source), let plan = connection.plan else { return }
        let shifted = date.addingTimeInterval(seconds)
        let start = event.startAt == nil ? Daylight.dayKey(shifted) : ISO8601DateFormatter().string(from: shifted)
        Task { await connection.moveEvent(event, to: start, accountID: plan.accountID) }
    }

    private func canMoveTask(_ task: DaylightTask, day: DaylightCalendarDay, forward: Bool) -> Bool {
        guard !connection.working, let index = day.tasks.firstIndex(where: { $0.id == task.id }) else { return false }
        let next = index + (forward ? 1 : -1)
        return day.tasks.indices.contains(next) && day.tasks[next].done == task.done
    }

    private func moveTask(_ task: DaylightTask, day: DaylightCalendarDay, forward: Bool) {
        guard canMoveTask(task, day: day, forward: forward), let plan = connection.plan,
              let index = day.tasks.firstIndex(where: { $0.id == task.id }) else { return }
        Task { await connection.moveTask(task, to: day.tasks[index + (forward ? 1 : -1)].id, after: forward, day: day.date, accountID: plan.accountID) }
    }

    private func frameReader(id: String, day: String, done: Bool = false) -> some View {
        GeometryReader { proxy in Color.clear.preference(key: CalendarFrames.self, value: [CalendarFrame(id: id, day: day, done: done, rect: proxy.frame(in: .named("calendar")))]) }
    }
    private func timeLabel(_ minute: Double) -> String { String(format: "%02d:%02d", Int(minute) / 60, Int(minute) % 60) }
    private func eventTime(_ event: DaylightCalendarEvent) -> String {
        guard let start = event.startAt.flatMap(DaylightTimeGrid.instant), let end = event.endAt.flatMap(DaylightTimeGrid.instant) else { return "종일" }
        return timeLabel(DaylightTimeGrid.minute(start, on: Daylight.dayKey(start))) + "–" + timeLabel(DaylightTimeGrid.minute(end, on: Daylight.dayKey(end)))
    }
}

private struct TaskDrag { let task: DaylightTask; let day: String; let point: CGPoint; let target: String?; let after: Bool }
private struct EventDrag { let event: DaylightCalendarEvent; let day: String; let minute: Double; let duration: Double; let allDay: Bool }
private struct CalendarFrame: Equatable { let id: String; let day: String; let done: Bool; let rect: CGRect }
private struct CalendarFrames: PreferenceKey {
    static let defaultValue: [CalendarFrame] = []
    static func reduce(value: inout [CalendarFrame], nextValue: () -> [CalendarFrame]) { value.append(contentsOf: nextValue()) }
}

private struct FlowTitle: View {
    let text: String
    let size: Double
    var done = false
    var paused = false
    @State private var hovered = false
    @State private var elapsed: TimeInterval = 0
    @State private var started = Date()
    private var stopped: Bool { paused || hovered }

    var body: some View {
        GeometryReader { geometry in
            let width = (text as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: size, weight: .medium)]).width
            let overflow = max(0, width - geometry.size.width + 4)
            TimelineView(.animation(minimumInterval: 1 / 30, paused: stopped || overflow == 0)) { context in
                let seconds = elapsed + (stopped ? 0 : context.date.timeIntervalSince(started))
                let travel = max(1, overflow / 24)
                let phase = seconds.truncatingRemainder(dividingBy: 3 + travel * 2)
                let offset = phase < 1.5 ? 0 : phase < 1.5 + travel ? (phase - 1.5) / travel * overflow : phase < 3 + travel ? overflow : (1 - (phase - 3 - travel) / travel) * overflow
                Text(text).font(.system(size: size, weight: .medium)).strikethrough(done)
                    .fixedSize(horizontal: true, vertical: false).offset(x: -offset)
            }.frame(maxWidth: .infinity, alignment: .leading).clipped()
        }
        .onHover { hovered = $0 }
        .onChange(of: stopped) { _, value in
            if value { elapsed += Date().timeIntervalSince(started) } else { started = Date() }
        }
        .help(text).accessibilityLabel(text)
    }
}

