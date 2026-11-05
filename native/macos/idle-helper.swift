// Big Eyes idle helper (macOS).
//
// Prints one line per tick with the seconds since the last event of each kind, for the whole login session:
//   key click scroll move
// For example "93.3 53.0 4.9 3.3". Big Eyes uses these to tell typing, clicking and scrolling apart from
// tiny mouse movements (jitter), which the combined system idle counter cannot do.
//
// It reads only these counters (no event contents, no key values) and needs no permissions.
// Usage: idle-helper [interval-seconds]   (default 0.1). It exits when its parent closes stdin or stdout.
import CoreGraphics
import Foundation

let source = CGEventSourceStateID.combinedSessionState
func since(_ types: [CGEventType]) -> Double {
  types.map { CGEventSource.secondsSinceLastEventType(source, eventType: $0) }.min() ?? 1e9
}

let interval = Double(CommandLine.arguments.dropFirst().first ?? "") ?? 0.1
setvbuf(stdout, nil, _IOLBF, 0)
signal(SIGPIPE, SIG_DFL)

while true {
  let key = since([.keyDown, .flagsChanged])
  let click = since([.leftMouseDown, .rightMouseDown, .otherMouseDown])
  let scroll = since([.scrollWheel])
  let move = since([.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged])
  print(String(format: "%.2f %.2f %.2f %.2f", key, click, scroll, move))
  if getppid() == 1 { exit(0) } // the app is gone
  Thread.sleep(forTimeInterval: interval)
}
