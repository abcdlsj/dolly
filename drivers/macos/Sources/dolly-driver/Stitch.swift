import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Frames of one scrolling view, joined into one tall image.
///
/// Each frame is cut to `crop`, the view's own rectangle, and placed by how
/// far its content moved since the frame before, found by matching rows.
/// `trim` keeps a band at the view's top and bottom out of the matching and
/// out of every seam: a scroll view that fades its overflowing edge, or a
/// row hovered under the pointer, would otherwise leave a stripe at each join.
/// The first frame keeps its top and the last its bottom, so the image still
/// starts and ends as the view does. `chrome` adds what the window draws
/// above the view (from the first frame) and below it (from the last), so a
/// sidebar keeps its header and footer.
enum Stitch {
    static func run(
        files: [String],
        crop: [Int]?,
        trim: (top: Int, bottom: Int),
        out: String?,
        chrome: Bool
    ) throws -> [String: Any] {
        guard !files.isEmpty else { throw Failure("stitch wants at least one file", code: .usage) }
        let frames = try files.map(Frame.load)
        let full = (width: frames[0].width, height: frames[0].height)
        guard frames.allSatisfy({ $0.width == full.width && $0.height == full.height }) else {
            throw Failure("frames differ in size; capture them from one window without resizing it", code: .failed)
        }
        let rect = try region(crop, width: full.width, height: full.height)
        let top = min(max(trim.top, 0), rect.height / 3)
        let bottom = min(max(trim.bottom, 0), rect.height / 3)

        let rows = frames.map { Rows($0, rect: rect) }
        var offsets = [0]
        var scores = [0.0]
        for index in rows.indices.dropFirst() {
            let found = shift(from: rows[index - 1], to: rows[index], top: top, bottom: bottom)
            offsets.append(found.shift)
            scores.append((found.cost * 1000).rounded() / 1000)
        }

        var result: [String: Any] = ["offsets": offsets, "costs": scores]
        guard let out else { return result }

        // A frame that did not move adds nothing; keep the last of a run so
        // the bottom edge comes from the frame that reached it.
        var kept: [Int] = []
        for index in frames.indices {
            if index > 0, offsets[index] == 0, let last = kept.last, last == index - 1 {
                kept[kept.count - 1] = index
            } else {
                kept.append(index)
            }
        }
        var positions: [Int] = []
        var position = 0
        for (k, index) in kept.enumerated() {
            if k > 0 {
                for step in (kept[k - 1] + 1)...index { position += offsets[step] }
            }
            positions.append(position)
        }

        let above = chrome ? rect.y : 0
        let below = chrome ? full.height - rect.y - rect.height : 0
        let height = above + (positions.last ?? 0) + rect.height + below
        let width = rect.width
        var canvas = [UInt8](repeating: 0, count: width * height * 4)

        func copy(_ frame: Frame, rows source: Range<Int>, to destination: Int) {
            for (n, row) in source.enumerated() {
                let from = (row * frame.width + rect.x) * 4
                let to = (destination + n) * width * 4
                canvas.replaceSubrange(to..<(to + width * 4), with: frame.pixels[from..<(from + width * 4)])
            }
        }

        if above > 0 { copy(frames[kept[0]], rows: 0..<above, to: 0) }
        for (k, index) in kept.enumerated() {
            let first = k == 0
            let last = k == kept.count - 1
            let start = first ? 0 : top
            let end = last ? rect.height : rect.height - bottom
            copy(frames[index], rows: (rect.y + start)..<(rect.y + end), to: above + positions[k] + start)
        }
        if below > 0 {
            copy(frames[kept[kept.count - 1]], rows: (rect.y + rect.height)..<full.height, to: height - below)
        }

        try write(canvas, width: width, height: height, space: frames[0].space, to: URL(fileURLWithPath: out))
        result["pixels"] = [width, height]
        result["used"] = kept.count
        return result
    }

    private static func region(_ crop: [Int]?, width: Int, height: Int) throws -> (x: Int, y: Int, width: Int, height: Int) {
        guard let crop else { return (0, 0, width, height) }
        guard crop.count == 4 else { throw Failure("crop wants [x, y, width, height] in pixels", code: .usage) }
        let x = min(max(crop[0], 0), width - 1)
        let y = min(max(crop[1], 0), height - 1)
        let w = min(max(crop[2], 1), width - x)
        let h = min(max(crop[3], 1), height - y)
        guard h >= 24 else { throw Failure("crop is too short to match frames", code: .usage) }
        return (x, y, w, h)
    }

    /// How far `b`'s content sits above `a`'s: `b` row r shows what `a` row
    /// r + shift showed. Rows are compared by a coarse fingerprint first,
    /// then the best few candidates by their pixels.
    private static func shift(from a: Rows, to b: Rows, top: Int, bottom: Int) -> (shift: Int, cost: Double) {
        let usable = a.height - top - bottom
        let minimum = max(16, usable / 6)
        var candidates: [(shift: Int, cost: Double)] = []
        for s in 0...max(usable - minimum, 0) {
            var total = 0.0
            var count = 0
            var r = top
            while r + s < a.height - bottom {
                total += a.fingerprintDistance(row: r + s, other: b, otherRow: r)
                count += 1
                r += 1
            }
            if count >= minimum { candidates.append((s, total / Double(count))) }
        }
        guard !candidates.isEmpty else { return (0, .infinity) }
        let best = candidates.sorted { $0.cost < $1.cost }.prefix(6)
        var winner = (shift: 0, cost: Double.infinity)
        for candidate in best {
            var total = 0.0
            var count = 0
            var r = top
            while r + candidate.shift < a.height - bottom {
                total += a.pixelDistance(row: r + candidate.shift, other: b, otherRow: r)
                count += 1
                r += 2
            }
            let cost = count > 0 ? total / Double(count) : .infinity
            // A near tie goes to the smaller move: an unchanged view must read as unchanged.
            if cost < winner.cost - 0.05 || (abs(cost - winner.cost) <= 0.05 && candidate.shift < winner.shift) {
                winner = (candidate.shift, cost)
            }
        }
        return winner
    }

    private static func write(_ pixels: [UInt8], width: Int, height: Int, space: CGColorSpace, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var bytes = pixels
        let image: CGImage? = bytes.withUnsafeMutableBytes { buffer in
            CGContext(
                data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width * 4, space: space,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )?.makeImage()
        }
        guard let image,
              let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw Failure("cannot write \(url.path)", code: .failed)
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw Failure("cannot write \(url.path)", code: .failed) }
    }
}

/// One decoded frame as RGBA bytes, top row first.
private struct Frame {
    let width: Int
    let height: Int
    let pixels: [UInt8]
    let space: CGColorSpace

    static func load(_ path: String) throws -> Frame {
        guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw Failure("cannot read \(path)", code: .failed)
        }
        let space = image.colorSpace.flatMap { $0.model == .rgb ? $0 : nil }
            ?? CGColorSpace(name: CGColorSpace.sRGB)!
        var pixels = [UInt8](repeating: 0, count: image.width * image.height * 4)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8,
                bytesPerRow: image.width * 4, space: space,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            return true
        }
        guard drawn else { throw Failure("cannot decode \(path)", code: .failed) }
        return Frame(width: image.width, height: image.height, pixels: pixels, space: space)
    }
}

/// A frame's crop as grey rows, with a per-row fingerprint of column sums.
private struct Rows {
    static let bins = 24
    let width: Int
    let height: Int
    let grey: [UInt8]
    let prints: [Float]

    init(_ frame: Frame, rect: (x: Int, y: Int, width: Int, height: Int)) {
        width = rect.width
        height = rect.height
        var grey = [UInt8](repeating: 0, count: width * height)
        var prints = [Float](repeating: 0, count: height * Self.bins)
        let binWidth = max(width / Self.bins, 1)
        for r in 0..<height {
            let row = (rect.y + r) * frame.width
            for c in 0..<width {
                let i = (row + rect.x + c) * 4
                let value = (UInt16(frame.pixels[i]) * 3 + UInt16(frame.pixels[i + 1]) * 6 + UInt16(frame.pixels[i + 2])) / 10
                grey[r * width + c] = UInt8(value)
                prints[r * Self.bins + min(c / binWidth, Self.bins - 1)] += Float(value)
            }
        }
        let scale = 1 / Float(binWidth)
        for i in prints.indices { prints[i] *= scale }
        self.grey = grey
        self.prints = prints
    }

    func fingerprintDistance(row: Int, other: Rows, otherRow: Int) -> Double {
        var total: Float = 0
        let a = row * Self.bins
        let b = otherRow * Self.bins
        for k in 0..<Self.bins { total += abs(prints[a + k] - other.prints[b + k]) }
        return Double(total / Float(Self.bins))
    }

    func pixelDistance(row: Int, other: Rows, otherRow: Int) -> Double {
        var total = 0
        let a = row * width
        let b = otherRow * width
        var c = 0
        while c < width {
            total += abs(Int(grey[a + c]) - Int(other.grey[b + c]))
            c += 2
        }
        return Double(total) / Double((width + 1) / 2)
    }
}
