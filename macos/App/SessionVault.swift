import Foundation
import Security

struct DaylightLogin: Codable {
    let session: String
    let expiresAt: Int64

    var isActive: Bool { Double(expiresAt) > Date().timeIntervalSince1970 }
}

enum SessionVault {
    private static func query(for server: URL) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.lunamana.daylight",
            kSecAttrAccount as String: server.absoluteString,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    static func read(for server: URL) -> DaylightLogin? {
        var attributes = query(for: server)
        attributes[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(attributes as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(DaylightLogin.self, from: data)
    }

    static func write(_ login: DaylightLogin, for server: URL) throws {
        let data = try JSONEncoder().encode(login)
        var attributes = query(for: server)
        let updated = SecItemUpdate(
            attributes as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if updated == errSecSuccess { return }
        guard updated == errSecItemNotFound else { throw DaylightError.keychain }
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else { throw DaylightError.keychain }
    }

    static func remove(for server: URL) throws {
        let removed = SecItemDelete(query(for: server) as CFDictionary)
        guard removed == errSecSuccess || removed == errSecItemNotFound else { throw DaylightError.keychain }
    }
}
