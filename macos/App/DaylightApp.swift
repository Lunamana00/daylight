import AppKit
import SwiftUI

@main
struct DaylightApp: App {
    @NSApplicationDelegateAdaptor(DesktopCalendarAppDelegate.self) private var desktop

    var body: some Scene {
        MenuBarExtra("daylight", systemImage: "sun.max") {
            Button("바탕화면 달력 표시") { desktop.showCalendar() }
            Button("달력 숨기기") { desktop.panel?.orderOut(nil) }
            Divider()
            Button("동기화") { Task { try? await PlannerConnection.shared.synchronize() } }
            if let server = Daylight.server {
                Button("daylight 웹 열기") { NSWorkspace.shared.open(server) }
                Button("Google 일정 이동 연결…") { NSWorkspace.shared.open(server.appending(path: "calendar/edit")) }
            }
            Divider()
            Button("daylight 종료") { NSApplication.shared.terminate(nil) }
        }
    }
}

@MainActor
final class DesktopCalendarAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private(set) var panel: DesktopCalendarPanel?
    private let frameName = "daylight.desktop.widget"

    func applicationDidFinishLaunching(_ notification: Notification) { showCalendar() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showCalendar(); return false }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            if url == Daylight.openCalendar { showCalendar() }
            if url == Daylight.openApp, let server = Daylight.server { NSWorkspace.shared.open(server) }
        }
    }

    func showCalendar() {
        if let panel { panel.orderFrontRegardless(); return }
        guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
        let visible = screen.visibleFrame
        let frame = DaylightDesktopLayout.fitted(CGRect(x: visible.minX + 24, y: visible.maxY - 524, width: 1000, height: 500), in: visible)
        let panel = DesktopCalendarPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "daylight 바탕화면 달력"
        panel.identifier = NSUserInterfaceItemIdentifier("desktop-calendar")
        panel.isReleasedWhenClosed = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isFloatingPanel = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.worksWhenModal = true
        // Stay above desktop icons and below every ordinary app window, including after a click.
        panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
        panel.isExcludedFromWindowsMenu = true
        panel.isMovableByWindowBackground = false
        panel.minSize = DaylightDesktopLayout.minimum
        panel.delegate = self
        let content = NSHostingView(rootView: DesktopCalendarView(connection: PlannerConnection.shared))
        content.sizingOptions = []
        let glass = NSGlassEffectView(frame: CGRect(origin: .zero, size: frame.size))
        glass.style = .clear
        glass.cornerRadius = 28
        glass.tintColor = NSColor.black.withAlphaComponent(0.18)
        glass.appearance = NSAppearance(named: .darkAqua)
        glass.contentView = content
        panel.contentView = glass
        self.panel = panel
        if panel.setFrameUsingName(frameName), let restoredScreen = panel.screen {
            panel.setFrame(DaylightDesktopLayout.fitted(panel.frame, in: restoredScreen.visibleFrame), display: false)
        }
        panel.setFrameAutosaveName(frameName)
        assert(!panel.styleMask.contains(.titled) && panel.level.rawValue < NSWindow.Level.normal.rawValue && panel.collectionBehavior.contains(.stationary))
        panel.orderFrontRegardless()
    }

    func windowDidMove(_ notification: Notification) { panel?.saveFrame(usingName: frameName) }
    func windowDidResize(_ notification: Notification) { panel?.saveFrame(usingName: frameName) }
}

final class DesktopCalendarPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

struct DesktopWidgetHandle: NSViewRepresentable {
    var resize = false

    func makeNSView(context: Context) -> HandleView {
        let view = HandleView()
        view.resize = resize
        view.setAccessibilityElement(true)
        view.setAccessibilityRole(.button)
        view.setAccessibilityLabel(resize ? "위젯 크기 조절, 방향키 사용" : "위젯 이동, 방향키 사용")
        return view
    }
    func updateNSView(_ view: HandleView, context: Context) { view.resize = resize }

    final class HandleView: NSView {
        var resize = false
        private var initialFrame = CGRect.zero
        private var initialPoint = CGPoint.zero
        override var acceptsFirstResponder: Bool { true }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
        override func mouseDown(with event: NSEvent) {
            guard let window else { return }
            window.makeFirstResponder(self)
            initialFrame = window.frame
            initialPoint = NSEvent.mouseLocation
            if !resize { window.performDrag(with: event); fitToScreen() }
        }
        override func mouseDragged(with event: NSEvent) {
            guard resize, let window, let screen = window.screen else { return }
            let point = NSEvent.mouseLocation
            window.setFrame(DaylightDesktopLayout.resized(initialFrame, dx: point.x - initialPoint.x, dy: point.y - initialPoint.y, in: screen.visibleFrame), display: true)
        }
        override func mouseUp(with event: NSEvent) { fitToScreen() }
        override func resetCursorRects() { addCursorRect(bounds, cursor: resize ? .crosshair : .openHand) }
        override func accessibilityPerformPress() -> Bool { window?.makeKey(); return window?.makeFirstResponder(self) ?? false }
        override func keyDown(with event: NSEvent) {
            guard let window, let screen = window.screen else { return }
            let step: Double = event.modifierFlags.contains(.shift) ? 30 : 10
            let delta: CGPoint
            switch event.keyCode {
            case 123: delta = CGPoint(x: -step, y: 0)
            case 124: delta = CGPoint(x: step, y: 0)
            case 125: delta = CGPoint(x: 0, y: -step)
            case 126: delta = CGPoint(x: 0, y: step)
            default: super.keyDown(with: event); return
            }
            let frame = resize ? DaylightDesktopLayout.resized(window.frame, dx: delta.x, dy: delta.y, in: screen.visibleFrame)
                : DaylightDesktopLayout.fitted(window.frame.offsetBy(dx: delta.x, dy: delta.y), in: screen.visibleFrame)
            window.setFrame(frame, display: true)
        }
        private func fitToScreen() {
            guard let window, let screen = window.screen else { return }
            window.setFrame(DaylightDesktopLayout.fitted(window.frame, in: screen.visibleFrame), display: true)
        }
    }
}
