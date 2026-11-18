// Big Eyes idle helper (macOS).
//
// Prints one line per tick with the seconds since the last event of each kind, for the whole login session:
//   key click scroll move
// For example "93.3 53.0 4.9 3.3". Big Eyes uses these to tell typing, clicking and scrolling apart from
// tiny mouse movements (jitter), which the combined system idle counter cannot do.
//
// It reads only these counters (no event contents, no key values) and needs no permissions.
// Usage: idle-helper [interval-seconds]   (default 0.1). It exits when its parent closes stdin or stdout.
//
// Other commands, used by "Eyes replace the screen saver" -> "Lock the Screen":
//   idle-helper --lock       locks the screen now (the same lock as Control-Command-Q), then exits.
//   idle-helper --can-lock   exits with 0 if the lock function exists (for tests; does not lock).
import CoreGraphics
import Foundation

/// The system lock function (login.framework). Not a public API, so it is looked up at run time.
func lockFunction() -> (@convention(c) () -> Int32)? {
  let framework = "/System/Library/PrivateFrameworks/login.framework/Versions/Current/login"
  guard let handle = dlopen(framework, RTLD_NOW), let symbol = dlsym(handle, "SACLockScreenImmediate") else { return nil }
  return unsafeBitCast(symbol, to: (@convention(c) () -> Int32).self)
}

switch CommandLine.arguments.dropFirst().first {
case "--lock":
  guard let lock = lockFunction() else { exit(2) }
  exit(lock() == 0 ? 0 : 3)
case "--can-lock":
  exit(lockFunction() == nil ? 2 : 0)
default:
  break
}

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
