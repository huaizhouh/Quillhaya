// macOS build-time asset preparation; the supplied source artwork stays untouched.
import Foundation
import CoreGraphics
import ImageIO
import CryptoKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("Icon preparation failed: \(message)\n".utf8))
    exit(1)
}
func bitmap(_ width: Int, _ height: Int) -> CGContext {
    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue)
    else { fail("Cannot create RGBA bitmap.") }
    context.interpolationQuality = .high
    return context
}
func writePNG(_ image: CGImage, to url: URL) {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil)
    else { fail("Cannot create \(url.path).") }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fail("Cannot save \(url.path).") }
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let sourceURL = root.appendingPathComponent("icon/icon.png")
let output = root.appendingPathComponent("icon/generated", isDirectory: true)
let iconset = output.appendingPathComponent("app-icon.iconset", isDirectory: true)
guard let sourceData = try? Data(contentsOf: sourceURL),
      let source = CGImageSourceCreateWithData(sourceData as CFData, nil),
      let original = CGImageSourceCreateImageAtIndex(source, 0, nil)
else { fail("Provide the original feather artwork at icon/icon.png.") }
guard original.width == original.height, original.width >= 1024 else {
    fail("Expected square source artwork of at least 1024 pixels.")
}

// This source is a black feather on white. Locate its dark artwork to remove only
// surplus white space, then center it without tracing or redrawing any strokes.
let pixels = bitmap(original.width, original.height)
pixels.draw(original, in: CGRect(x: 0, y: 0, width: original.width, height: original.height))
let rgba = pixels.data!.assumingMemoryBound(to: UInt8.self)
var left = original.width, right = -1, top = original.height, bottom = -1
for y in 0..<original.height {
    for x in 0..<original.width {
        let offset = (y * original.width + x) * 4
        let alpha = Int(rgba[offset + 3])
        // Compare unpremultiplied brightness; ignore transparent edge pixels.
        if alpha > 127 && (0..<3).allSatisfy({ Int(rgba[offset + $0]) * 255 < 160 * alpha }) {
            left = min(left, x); right = max(right, x)
            top = min(top, y); bottom = max(bottom, y)
        }
    }
}
guard right > left, bottom > top else { fail("No dark feather artwork found on the white source.") }
let artwork = CGRect(x: left, y: top, width: right - left + 1, height: bottom - top + 1)
// The longest artwork dimension occupies 66% of the white tile. The source crop
// is square, preserving the feather's original aspect ratio and direction.
let cropSide = ceil(max(artwork.width, artwork.height) / 0.66)
let crop = CGRect(x: floor(artwork.midX - cropSide / 2), y: floor(artwork.midY - cropSide / 2), width: cropSide, height: cropSide)
guard CGRect(x: 0, y: 0, width: original.width, height: original.height).contains(crop),
      let feather = original.cropping(to: crop) else { fail("Not enough white margin around the source artwork.") }

let master = bitmap(1024, 1024)
let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
master.addPath(CGPath(roundedRect: tile, cornerWidth: 184, cornerHeight: 184, transform: nil))
master.clip()
master.setFillColor(CGColor(gray: 1, alpha: 1))
master.fill(tile)
master.draw(feather, in: tile)
guard let image = master.makeImage() else { fail("Cannot render the master icon.") }
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
writePNG(image, to: output.appendingPathComponent("app-icon.png"))

let representations: [(String, Int)] = [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024)
]
for (name, size) in representations {
    let resized = bitmap(size, size)
    resized.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
    writePNG(resized.makeImage()!, to: iconset.appendingPathComponent(name))
}
let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", output.appendingPathComponent("app-icon.icns").path]
try iconutil.run(); iconutil.waitUntilExit()
guard iconutil.terminationStatus == 0 else { fail("iconutil could not assemble the ICNS file.") }
let manifest: [String: Any] = [
    "source": "icon/icon.png", "sourceSHA256": SHA256.hash(data: sourceData).map { String(format: "%02x", $0) }.joined(),
    "canvasSize": 1024, "tileInset": 100, "tileSize": 824, "cornerRadius": 184,
    "artworkFractionOfTile": 0.66,
    "sourceArtworkBounds": [left, top, right + 1, bottom + 1],
    "sourceCrop": [Int(crop.minX), Int(crop.minY), Int(crop.width), Int(crop.height)],
    "representations": representations.map { ["file": $0.0, "pixels": $0.1] as [String: Any] }
]
try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
    .write(to: output.appendingPathComponent("manifest.json"))
print("Prepared original feather artwork: 1024px RGBA master, 824px rounded tile, 100px transparent inset, 10 ICNS representations.")
