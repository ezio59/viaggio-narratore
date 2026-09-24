import SwiftUI
import WebKit

@main
struct ViaggioNarratoreApp: App {
    @StateObject private var tracker = JourneyTracker()

    var body: some Scene {
        WindowGroup {
            JourneyWebView(tracker: tracker)
                .ignoresSafeArea(edges: .bottom)
        }
    }
}

struct JourneyWebView: UIViewRepresentable {
    @ObservedObject var tracker: JourneyTracker

    func makeCoordinator() -> Coordinator { Coordinator(tracker: tracker) }

    func makeUIView(context: Context) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "viaggio")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        let webView = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.webView = webView
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.96, green: 0.96, blue: 0.93, alpha: 1)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        tracker.onPosition = { [weak webView] location in
            guard let webView else { return }
            let coords: [String: Double] = [
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy
            ]
            guard let data = try? JSONSerialization.data(withJSONObject: coords),
                  let json = String(data: data, encoding: .utf8) else { return }
            webView.evaluateJavaScript("window.viaggioNativePosition?.(\(json))")
        }
        tracker.onError = { [weak webView] message in
            guard let webView, let encoded = try? JSONSerialization.data(withJSONObject: [message]),
                  let json = String(data: encoded, encoding: .utf8) else { return }
            webView.evaluateJavaScript("window.viaggioNativeError?.(\(json)[0])")
        }
        webView.uiDelegate = context.coordinator
        webView.load(URLRequest(url: URL(string: "https://ezio59.github.io/viaggio-narratore/")!))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
        let tracker: JourneyTracker
        weak var webView: WKWebView?

        init(tracker: JourneyTracker) { self.tracker = tracker }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.securityOrigin.host == "ezio59.github.io",
                  let data = message.body as? [String: Any], let type = data["type"] as? String else { return }
            switch type {
            case "ready":
                if tracker.isRunning {
                    webView?.evaluateJavaScript("window.viaggioNativeRestore?.(\(tracker.voiceOn ? "true" : "false"))") { [weak self] _, _ in
                        self?.tracker.sendLatestPosition()
                    }
                }
            case "start": tracker.start()
            case "stop": tracker.stop()
            case "refresh": tracker.sendLatestPosition()
            case "voice": tracker.voiceOn = data["value"] as? Bool ?? true
            case "cancel": tracker.cancelSpeech()
            case "speak":
                guard let payload = data["value"] as? [String: Any],
                      let text = payload["text"] as? String else { return }
                tracker.speak(text, replace: payload["replace"] as? Bool ?? true)
            default: break
            }
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
                UIApplication.shared.open(url)
            }
            return nil
        }

    }
}
