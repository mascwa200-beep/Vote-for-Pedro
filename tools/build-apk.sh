#!/usr/bin/env bash
#
# Builds a sideloadable Android APK.
#
# Deliberately does not use Gradle. The app is one Java file and a handful of
# resources, so it goes straight through the SDK tools: aapt2 to compile and
# link resources, javac to build the activity, d8 to dex it, then zipalign and
# apksigner. That keeps the build hermetic — no Maven, no plugin resolution,
# no network at build time.
#
# Requires: ANDROID_HOME pointing at an SDK with build-tools and a platform.
#
#   ANDROID_HOME=/path/to/sdk ./tools/build-apk.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${ANDROID_HOME:?Set ANDROID_HOME to your Android SDK root}"

BUILD_TOOLS_DIR="$(ls -d "$ANDROID_HOME"/build-tools/*/ 2>/dev/null | sort -V | tail -1)"
[ -n "$BUILD_TOOLS_DIR" ] || { echo "No build-tools found in $ANDROID_HOME" >&2; exit 1; }
BUILD_TOOLS="${BUILD_TOOLS_DIR%/}"

PLATFORM_JAR="$(ls "$ANDROID_HOME"/platforms/*/android.jar 2>/dev/null | sort -V | tail -1)"
[ -n "$PLATFORM_JAR" ] || { echo "No platform android.jar found in $ANDROID_HOME" >&2; exit 1; }

AAPT2="$BUILD_TOOLS/aapt2"
D8="$BUILD_TOOLS/d8"
ZIPALIGN="$BUILD_TOOLS/zipalign"
APKSIGNER="$BUILD_TOOLS/apksigner"

OUT="$ROOT/build/android"
DIST="$ROOT/dist"
APK_NAME="starfleet-command.apk"

echo "==> SDK:      $ANDROID_HOME"
echo "==> Tools:    $(basename "$BUILD_TOOLS")"
echo "==> Platform: $(basename "$(dirname "$PLATFORM_JAR")")"

# ---------------------------------------------------------------- game asset

echo "==> Building the game bundle"
node "$ROOT/tools/build-single.mjs" >/dev/null
mkdir -p "$ROOT/android/assets"
cp "$DIST/starfleet-command.html" "$ROOT/android/assets/game.html"
echo "    asset: $(du -h "$ROOT/android/assets/game.html" | cut -f1)"

# ---------------------------------------------------------------- resources

rm -rf "$OUT"
mkdir -p "$OUT/compiled" "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "==> Compiling resources"
"$AAPT2" compile --dir "$ROOT/android/res" -o "$OUT/compiled/res.zip"

echo "==> Linking resources"
"$AAPT2" link \
  -I "$PLATFORM_JAR" \
  --manifest "$ROOT/android/AndroidManifest.xml" \
  -A "$ROOT/android/assets" \
  --java "$OUT/gen" \
  --min-sdk-version 26 \
  --target-sdk-version 35 \
  --version-code 1 \
  --version-name "1.0" \
  -o "$OUT/base.apk" \
  "$OUT/compiled/res.zip"

# ---------------------------------------------------------------- code

echo "==> Compiling Java"
find "$ROOT/android/java" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
# --release with an explicit --system is rejected against android.jar, and
# -bootclasspath is refused for target 17+, so compile against the platform
# jar on the classpath and let d8 desugar for the min API.
javac \
  -source 17 -target 17 \
  -classpath "$PLATFORM_JAR" \
  -d "$OUT/classes" \
  -nowarn \
  -Xlint:-options \
  @"$OUT/sources.txt"

echo "==> Dexing"
find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
"$D8" \
  --lib "$PLATFORM_JAR" \
  --min-api 26 \
  --release \
  --output "$OUT/dex" \
  @"$OUT/classes.txt"

# ---------------------------------------------------------------- package

echo "==> Packaging"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q -X "$OUT/unsigned.apk" classes.dex)

echo "==> Aligning"
"$ZIPALIGN" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

# A debug keystore is generated on first run. It is enough to sideload with;
# it is not a release key and is not committed.
KEYSTORE="$OUT/../debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
  echo "==> Generating a signing key"
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair \
    -keystore "$KEYSTORE" \
    -storepass starfleet -keypass starfleet \
    -alias starfleet \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=Starfleet Command, OU=Sideload, O=Fan Project, C=US" \
    >/dev/null 2>&1
fi

echo "==> Signing"
"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-pass pass:starfleet \
  --key-pass pass:starfleet \
  --ks-key-alias starfleet \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$DIST/$APK_NAME" \
  "$OUT/aligned.apk"

echo "==> Verifying signature"
"$APKSIGNER" verify --verbose "$DIST/$APK_NAME" | sed 's/^/    /'

SIZE="$(du -h "$DIST/$APK_NAME" | cut -f1)"
echo
echo "APK built: dist/$APK_NAME ($SIZE)"
echo "Install with:  adb install -r dist/$APK_NAME"
echo "Or copy it to the phone and open it with the Files app."
