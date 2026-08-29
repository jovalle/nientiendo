device_rows() {
  grep -v '^#' "$BATS_TEST_DIRNAME/fixtures/nextui-devices.tsv"
}

run_render() {
  run "$NEXTUI_AUTOMATION" render \
    --device "$1" \
    --source "$2" \
    --root "$3"
}

run_cleanup() {
  run "$NEXTUI_AUTOMATION" cleanup --root "$1"
}

run_detect() {
  run "$NEXTUI_AUTOMATION" detect --root "$1"
}

run_logos() {
  run "$NEXTUI_AUTOMATION" logos \
    --device "$1" \
    --source "$2" \
    --root "$3" \
    --yes
}

run_uninstall() {
  run "$NEXTUI_AUTOMATION" uninstall --root "$1"
}

prepare_release_fixture() {
  RELEASE_BUILD=NextUI-20260829-0
  RELEASE_DIR="$BATS_TEST_TMPDIR/release"
  RELEASE_METADATA="$RELEASE_DIR/latest.json"
  local payload="$RELEASE_DIR/payload"
  local minui_payload="$RELEASE_DIR/minui-payload"
  local base_archive="$RELEASE_DIR/$RELEASE_BUILD-base.zip"
  local all_archive="$RELEASE_DIR/$RELEASE_BUILD-all.zip"
  local previous_directory=$PWD base_digest all_digest base_size all_size

  mkdir -p "$payload/trimui/app" "$payload/Emus/demo" "$minui_payload/.system"
  printf '%s\n%s\n' "$RELEASE_BUILD" 'abc1234' >"$minui_payload/.system/version.txt"
  printf 'new bootstrap\n' >"$payload/trimui/app/bootstrap.txt"
  printf 'extra emulator\n' >"$payload/Emus/demo/readme.txt"
  printf 'NextUI fixture\n' >"$payload/README.txt"

  cd "$minui_payload"
  zip -qr "$payload/MinUI.zip" .
  cd "$payload"
  zip -qr "$base_archive" MinUI.zip trimui README.txt
  zip -qr "$all_archive" .
  cd "$previous_directory"

  base_digest=$(shasum -a 256 "$base_archive" | awk '{print $1}')
  all_digest=$(shasum -a 256 "$all_archive" | awk '{print $1}')
  base_size=$(wc -c <"$base_archive")
  all_size=$(wc -c <"$all_archive")
  printf '{"tag_name":"v9.0.0","html_url":"https://example.test/v9.0.0","draft":false,"prerelease":false,"assets":[{"name":"%s-base.zip","size":%d,"digest":"sha256:%s","browser_download_url":"%s"},{"name":"%s-all.zip","size":%d,"digest":"sha256:%s","browser_download_url":"%s"}]}\n' \
    "$RELEASE_BUILD" "$base_size" "$base_digest" "$base_archive" \
    "$RELEASE_BUILD" "$all_size" "$all_digest" "$all_archive" >"$RELEASE_METADATA"

  export NEXTUI_RELEASE_API=$RELEASE_METADATA
  export NEXTUI_MEDIA_INFO='{"filesystem":"exfat","partitionScheme":"mbr"}'
}

prepare_installed_card() {
  mkdir -p "$SDCARD/.system/tg5040" "$SDCARD/trimui/app"
  printf 'NextUI-20260101-0\noldhash\n' >"$SDCARD/.system/version.txt"
  printf 'old bootstrap\n' >"$SDCARD/trimui/app/bootstrap.txt"
}

assert_success() {
  if ((status != 0)); then
    printf 'expected success, got status %d\n%s\n' "$status" "$output" >&2
    return 1
  fi
}

assert_failure() {
  if ((status == 0)); then
    printf 'expected failure, got status 0\n%s\n' "$output" >&2
    return 1
  fi
}

read_le16() {
  local bytes
  read -r -a bytes <<<"$(od -An -tu1 -j "$2" -N 2 "$1")"
  printf '%d\n' "$((bytes[0] | bytes[1] << 8))"
}

read_le32() {
  local bytes
  read -r -a bytes <<<"$(od -An -tu1 -j "$2" -N 4 "$1")"
  printf '%d\n' "$((bytes[0] | bytes[1] << 8 | bytes[2] << 16 | bytes[3] << 24))"
}

read_bmp_pixel() {
  local bmp=$1 x=$2 y=$3 width height row_size offset bytes
  width=$(read_le32 "$bmp" 18)
  height=$(read_le32 "$bmp" 22)
  row_size=$(((width * 3 + 3) / 4 * 4))
  offset=$((54 + (height - y - 1) * row_size + x * 3))
  read -r -a bytes <<<"$(od -An -tu1 -j "$offset" -N 3 "$bmp")"
  printf '%d %d %d\n' "${bytes[2]}" "${bytes[1]}" "${bytes[0]}"
}

assert_bmp_pixel() {
  local bmp=$1 x=$2 y=$3 expected=$4 tolerance=${5:-0} actual index
  local -a expected_channels actual_channels
  actual=$(read_bmp_pixel "$bmp" "$x" "$y")
  read -r -a expected_channels <<<"$expected"
  read -r -a actual_channels <<<"$actual"
  for index in 0 1 2; do
    (( ${actual_channels[index]} >= ${expected_channels[index]} - tolerance &&
      ${actual_channels[index]} <= ${expected_channels[index]} + tolerance )) || {
    printf 'wrong BMP pixel at %d,%d in %s: expected %s, got %s\n' \
      "$x" "$y" "$bmp" "$expected" "$actual" >&2
    return 1
    }
  done
}

assert_bmp() {
  local bmp=$1 width=$2 height=$3 actual_size declared_size minimum_size row_size

  [[ -f $bmp ]] || {
    printf 'missing BMP: %s\n' "$bmp" >&2
    return 1
  }
  [[ $(head -c 2 "$bmp") == BM ]] || {
    printf 'invalid BMP signature: %s\n' "$bmp" >&2
    return 1
  }
  [[ $(read_le32 "$bmp" 18) == "$width" ]] || {
    printf 'wrong BMP width: %s\n' "$bmp" >&2
    return 1
  }
  [[ $(read_le32 "$bmp" 22) == "$height" ]] || {
    printf 'wrong BMP height: %s\n' "$bmp" >&2
    return 1
  }
  [[ $(read_le16 "$bmp" 28) == 24 ]] || {
    printf 'BMP is not 24-bit: %s\n' "$bmp" >&2
    return 1
  }
  [[ $(read_le32 "$bmp" 30) == 0 ]] || {
    printf 'BMP uses unsupported compression: %s\n' "$bmp" >&2
    return 1
  }
  actual_size=$(wc -c <"$bmp")
  declared_size=$(read_le32 "$bmp" 2)
  row_size=$(((width * 3 + 3) / 4 * 4))
  minimum_size=$((54 + row_size * height))
  ((declared_size == actual_size && actual_size >= minimum_size)) || {
    printf 'BMP is truncated or has an invalid file size: %s\n' "$bmp" >&2
    return 1
  }
}
