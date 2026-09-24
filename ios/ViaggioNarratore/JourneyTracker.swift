import AVFoundation
import Combine
import CoreLocation
import Foundation
import UIKit

/// The native owner of GPS and speech. WKWebView may be suspended while Maps is in front.
final class JourneyTracker: NSObject, ObservableObject, CLLocationManagerDelegate, AVSpeechSynthesizerDelegate {
    private let manager = CLLocationManager()
    private let synthesizer = AVSpeechSynthesizer()
    private let session = URLSession.shared
    private var running = false
    var isRunning: Bool { running }
    private var generation = 0
    private var lookupSequence = 0
    private var lastLookup: (location: CLLocation, date: Date)?
    private var lastMunicipalityKey: String?
    private var lastLocation: CLLocation?
    var voiceOn = true {
        didSet { if !voiceOn { cancelSpeech() } }
    }
    var onPosition: ((CLLocation) -> Void)?
    var onError: ((String) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.activityType = .automotiveNavigation
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 75
        manager.pausesLocationUpdatesAutomatically = false
        synthesizer.delegate = self
    }

    func start() {
        guard !running else { sendLatestPosition(); return }
        running = true
        generation += 1
        lookupSequence += 1
        lastLookup = nil
        lastMunicipalityKey = nil
        let status = manager.authorizationStatus
        if status == .notDetermined {
            manager.requestWhenInUseAuthorization()
        } else if status == .authorizedWhenInUse || status == .authorizedAlways {
            beginUpdates()
        } else {
            report("Consenti la posizione nelle Impostazioni di iPhone per avviare il viaggio.")
        }
    }

    private func beginUpdates() {
        guard running else { return }
        // This requires UIBackgroundModes/location in Info.plist. Start in the foreground.
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
    }

    func stop() {
        guard running else { return }
        running = false
        generation += 1
        lookupSequence += 1
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        lastLocation = nil
        lastLookup = nil
        cancelSpeech()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if running && (manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways) {
            beginUpdates()
        } else if running && manager.authorizationStatus == .denied {
            report("Posizione negata: abilitala nelle Impostazioni di iPhone.")
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if running { report("Il GPS non riesce a trovare la posizione. Riprova all’aperto.") }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard running, let location = locations.last,
              location.horizontalAccuracy >= 0,
              location.timestamp.timeIntervalSinceNow > -30 else { return }
        lastLocation = location
        sendLatestPosition()
        let now = Date()
        if let previous = lastLookup {
            if now.timeIntervalSince(previous.date) < 8 { return }
            if location.distance(from: previous.location) < 120 && now.timeIntervalSince(previous.date) < 45 { return }
        }
        if location.horizontalAccuracy > 250 && lastMunicipalityKey != nil { return }
        lastLookup = (location, now)
        identifyMunicipality(at: location, generation: generation)
    }

    func sendLatestPosition() {
        guard running, UIApplication.shared.applicationState == .active,
              let location = lastLocation else { return }
        onPosition?(location)
    }

    private func identifyMunicipality(at location: CLLocation, generation: Int) {
        lookupSequence += 1
        let sequence = lookupSequence
        var components = URLComponents(string: "https://api.bigdatacloud.net/data/reverse-geocode-client")!
        components.queryItems = [
            URLQueryItem(name: "latitude", value: String(location.coordinate.latitude)),
            URLQueryItem(name: "longitude", value: String(location.coordinate.longitude)),
            URLQueryItem(name: "localityLanguage", value: "it")
        ]
        guard let url = components.url else { return }
        session.dataTask(with: url) { [weak self] data, response, error in
            guard let self, error == nil,
                  let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            DispatchQueue.main.async {
                guard self.running && generation == self.generation && sequence == self.lookupSequence else { return }
                let country = json["countryCode"] as? String ?? ""
                let info = json["localityInfo"] as? [String: Any]
                let admins = info?["administrative"] as? [[String: Any]] ?? []
                let municipality = admins.first {
                    ($0["adminLevel"] as? NSNumber)?.intValue == 8 && $0["name"] is String
                }
                // In Italy a locality can be a hamlet, so only announce the level-8 comune.
                let name = (municipality?["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                let foreignName = (json["city"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let city = (country == "IT" ? name : name ?? foreignName), !city.isEmpty else { return }
                if location.horizontalAccuracy > 180 && self.lastMunicipalityKey != nil { return }
                let region = json["principalSubdivisionCode"] as? String ?? ""
                let key = "\(country.lowercased())|\(region.lowercased())|\(city.lowercased())"
                guard key != self.lastMunicipalityKey else { return }
                self.lastMunicipalityKey = key
                self.speak("Sei entrato nel comune di \(city).")
            }
        }.resume()
    }

    func speak(_ text: String, replace: Bool = true) {
        guard voiceOn, !text.isEmpty else { return }
        if replace { synthesizer.stopSpeaking(at: .immediate) }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .voicePrompt, options: [.mixWithOthers, .duckOthers])
            try audio.setActive(true)
            let utterance = AVSpeechUtterance(string: String(text.prefix(1000)))
            utterance.voice = AVSpeechSynthesisVoice(language: "it-IT")
            utterance.rate = 0.48
            synthesizer.speak(utterance)
        } catch {
            report("Non riesco ad avviare la voce. Verifica l’uscita audio dell’iPhone.")
        }
    }

    func cancelSpeech() {
        synthesizer.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        if !synthesizer.isSpeaking {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    private func report(_ message: String) { onError?(message) }
}
