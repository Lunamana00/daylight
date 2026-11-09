import SwiftUI

@main
struct DaylightApp: App {
    @StateObject private var connection = PlannerConnection.shared

    var body: some Scene {
        WindowGroup("daylight") {
            ConnectionView(connection: connection)
        }
        .windowResizability(.contentSize)
    }
}

private struct ConnectionView: View {
    @ObservedObject var connection: PlannerConnection
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("daylight", systemImage: "sun.max")
                .font(.title2.weight(.semibold))
            Text(connection.status)
                .foregroundStyle(.secondary)
            HStack {
                if connection.signedIn {
                    Button("동기화") { Task { try? await connection.synchronize() } }
                    Button("로그아웃") { Task { await connection.signOut() } }
                    if let server = connection.server {
                        Button("daylight 열기") { openURL(server) }
                    }
                } else {
                    Button("Google로 로그인") { Task { await connection.signIn() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(connection.server == nil)
                }
            }
            .disabled(connection.working)
        }
        .padding(24)
        .frame(minWidth: 340, alignment: .leading)
        .task { await connection.refresh() }
        .onOpenURL { url in
            if url == Daylight.openApp, connection.signedIn, let server = connection.server {
                openURL(server)
            }
        }
    }
}
