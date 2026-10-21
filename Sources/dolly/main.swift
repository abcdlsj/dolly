import Foundation

/// Entry point: resolve the verb, run it, and always answer with one JSON
/// object. Unknown verbs and bad arguments are usage failures, not crashes.

let arguments = Array(CommandLine.arguments.dropFirst())

guard let verb = arguments.first, !verb.hasPrefix("--") else {
    print(Usage.text())
    Output.write(["ok": true, "command": "help", "commands": Registry.all.map(\.name)])
    exit(Exit.ok.rawValue)
}

guard let command = Registry.lookup(verb) else {
    Output.failure(Failure("unknown command \"\(verb)\"; run dolly help"))
}

do {
    let parsed = try Args.parse(Array(arguments.dropFirst()))
    let fields = try command.run(parsed)
    Output.success(command.name, fields)
} catch let failure as Failure {
    Output.failure(failure)
} catch {
    Output.failure(Failure("\(error)", code: .failed))
}
