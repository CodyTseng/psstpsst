import ExpoModulesCore
import UniformTypeIdentifiers
import UIKit

public final class ExpoFileDropModule: Module {
  @MainActor
  private lazy var controller = FileDropController(
    onDragStateChanged: { [weak self] active in
      self?.sendEvent("onDragStateChanged", ["active": active])
    },
    onDrop: { [weak self] files in
      self?.sendEvent("onDrop", ["files": files.map(\.payload)])
    }
  )

  public func definition() -> ModuleDefinition {
    Name("ExpoFileDrop")

    Events("onDragStateChanged", "onDrop")

    AsyncFunction("setEnabledAsync") { (enabled: Bool) async in
      await MainActor.run {
        self.controller.setEnabled(enabled)
      }
    }
  }
}

private struct DroppedFile {
  let uri: String
  let name: String
  let mime: String
  let size: Int64

  var payload: [String: Any] {
    ["uri": uri, "name": name, "mime": mime, "size": size]
  }
}

@MainActor
private final class FileDropController: NSObject, UIDropInteractionDelegate {
  private let onDragStateChanged: (Bool) -> Void
  private let onDrop: ([DroppedFile]) -> Void
  private weak var targetView: UIView?
  private var interaction: UIDropInteraction?
  private var generation = 0

  init(
    onDragStateChanged: @escaping (Bool) -> Void,
    onDrop: @escaping ([DroppedFile]) -> Void
  ) {
    self.onDragStateChanged = onDragStateChanged
    self.onDrop = onDrop
  }

  func setEnabled(_ enabled: Bool) {
    generation += 1
    if !enabled {
      detach()
      return
    }
    guard interaction == nil, let view = activeRootView() else { return }
    let interaction = UIDropInteraction(delegate: self)
    view.addInteraction(interaction)
    targetView = view
    self.interaction = interaction
  }

  private func detach() {
    if let interaction {
      targetView?.removeInteraction(interaction)
    }
    interaction = nil
    targetView = nil
    onDragStateChanged(false)
  }

  private func activeRootView() -> UIView? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)?
      .rootViewController?.view
  }

  func dropInteraction(_ interaction: UIDropInteraction, canHandle session: UIDropSession) -> Bool {
    session.items.contains { preferredType(for: $0.itemProvider) != nil }
  }

  func dropInteraction(
    _ interaction: UIDropInteraction,
    sessionDidUpdate session: UIDropSession
  ) -> UIDropProposal {
    UIDropProposal(operation: .copy)
  }

  func dropInteraction(_ interaction: UIDropInteraction, sessionDidEnter session: UIDropSession) {
    onDragStateChanged(true)
  }

  func dropInteraction(_ interaction: UIDropInteraction, sessionDidExit session: UIDropSession) {
    onDragStateChanged(false)
  }

  func dropInteraction(_ interaction: UIDropInteraction, sessionDidEnd session: UIDropSession) {
    onDragStateChanged(false)
  }

  func dropInteraction(_ interaction: UIDropInteraction, performDrop session: UIDropSession) {
    onDragStateChanged(false)
    let dropGeneration = generation
    let candidates = session.items.compactMap { item -> (NSItemProvider, UTType)? in
      guard let type = preferredType(for: item.itemProvider) else { return nil }
      return (item.itemProvider, type)
    }
    guard !candidates.isEmpty else { return }

    let group = DispatchGroup()
    let lock = NSLock()
    var results = Array<DroppedFile?>(repeating: nil, count: candidates.count)
    for (index, candidate) in candidates.enumerated() {
      let provider = candidate.0
      let type = candidate.1
      let suggestedName = provider.suggestedName
      group.enter()
      provider.loadFileRepresentation(forTypeIdentifier: type.identifier) {
        [weak self] sourceURL, _ in
        defer { group.leave() }
        guard let self, let sourceURL else { return }
        guard let file = self.copyToCache(
          sourceURL: sourceURL,
          suggestedName: suggestedName,
          type: type
        ) else { return }
        lock.lock()
        results[index] = file
        lock.unlock()
      }
    }
    group.notify(queue: .main) { [weak self] in
      let files = results.compactMap { $0 }
      guard !files.isEmpty else { return }
      guard let self,
            dropGeneration == self.generation,
            self.interaction != nil else {
        Self.removeTemporaryFiles(files)
        return
      }
      self.onDrop(files)
    }
  }

  private func preferredType(for provider: NSItemProvider) -> UTType? {
    let representsFile = provider.suggestedName?.isEmpty == false ||
      provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
    guard representsFile else { return nil }
    return provider.registeredContentTypes.first { type in
      !type.conforms(to: .directory) &&
        (type.conforms(to: .data) || type.conforms(to: .content))
    }
  }

  nonisolated private func copyToCache(
    sourceURL: URL,
    suggestedName: String?,
    type: UTType
  ) -> DroppedFile? {
    let fileManager = FileManager.default
    let directory = fileManager.temporaryDirectory
      .appendingPathComponent("file-drops", isDirectory: true)
    let fallbackExtension = type.preferredFilenameExtension.map { ".\($0)" } ?? ""
    let rawName = suggestedName ?? sourceURL.lastPathComponent
    let name = sanitizedFilename(rawName.isEmpty ? "dropped-file\(fallbackExtension)" : rawName)
    let targetURL = directory.appendingPathComponent("\(UUID().uuidString)-\(name)")
    do {
      try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
      try fileManager.copyItem(at: sourceURL, to: targetURL)
      let values = try targetURL.resourceValues(forKeys: [.fileSizeKey])
      return DroppedFile(
        uri: targetURL.absoluteString,
        name: name,
        mime: type.preferredMIMEType ?? "application/octet-stream",
        size: Int64(values.fileSize ?? 0)
      )
    } catch {
      try? fileManager.removeItem(at: targetURL)
      return nil
    }
  }

  nonisolated private func sanitizedFilename(_ name: String) -> String {
    let cleaned = name.replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: ":", with: "_")
    return cleaned == "." || cleaned == ".." ? "dropped-file" : cleaned
  }

  nonisolated private static func removeTemporaryFiles(_ files: [DroppedFile]) {
    for file in files {
      guard let url = URL(string: file.uri) else { continue }
      try? FileManager.default.removeItem(at: url)
    }
  }
}
