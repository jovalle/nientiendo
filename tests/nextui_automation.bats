#!/usr/bin/env bats

load test_helper

setup() {
  : "${NEXTUI_AUTOMATION:=$BATS_TEST_DIRNAME/../bin/nextui}"
  if [[ ! -x $NEXTUI_AUTOMATION ]]; then
    printf 'NEXTUI_AUTOMATION is not executable: %s\n' "$NEXTUI_AUTOMATION" >&2
    return 1
  fi

  SOURCE_DIR="$BATS_TEST_TMPDIR/source logos"
  SOURCE="$SOURCE_DIR/Nientiendo Test.svg"
  SDCARD="$BATS_TEST_TMPDIR/SD Card"
  mkdir -p "$SOURCE_DIR" "$SDCARD"
  cp "$BATS_TEST_DIRNAME/fixtures/logo.svg" "$SOURCE"
}

@test "human-readable commands start with the detailed logo banner and blank-line spacing" {
  local help_output="$BATS_TEST_TMPDIR/help.txt"
  local detail_line
  "$NEXTUI_AUTOMATION" help >"$help_output"

  [[ -z $(sed -n '1p' "$help_output") ]]
  [[ $(sed -n '2p' "$help_output") == "         ##################################################################################" ]]
  detail_line=$(sed -n '9p' "$help_output")
  (( ${#detail_line} == 100 ))
  [[ $(sed -n '18p' "$help_output") == "         ##################################################################################" ]]
  [[ -z $(sed -n '19p' "$help_output") ]]
  [[ $(sed -n '20p' "$help_output") == "Usage:" ]]
}

@test "json output omits the logo banner" {
  run "$NEXTUI_AUTOMATION" help --json

  assert_success
  [[ ${lines[0]} == "Usage:" ]]
  [[ $output != *".=+*#"* ]]
}

@test "render writes the documented 24-bit BMP for every supported NextUI device" {
  local device_count=0

  while IFS=$'\t' read -r device relative_dir width height; do
    ((device_count += 1))
    local root="$SDCARD/$device"
    local expected="$root/$relative_dir/Nientiendo 1.bmp"

    run_render "$device" "$SOURCE" "$root"
    assert_success
    assert_bmp "$expected" "$width" "$height"
    [[ -f $SOURCE ]]
  done < <(device_rows)

  ((device_count > 0))
}

@test "render rejects an unsupported device without creating files" {
  run_render "unsupported" "$SOURCE" "$SDCARD"

  assert_failure
  [[ -z $(find "$SDCARD" -type f -print -quit) ]]
  [[ -f $SOURCE ]]
}

@test "render rejects a missing SVG without creating files" {
  run_render "brick" "$SOURCE_DIR/missing.svg" "$SDCARD"

  assert_failure
  [[ -z $(find "$SDCARD" -type f -print -quit) ]]
}

@test "no arguments defaults to install and requires a root outside a terminal" {
  run "$NEXTUI_AUTOMATION"

  assert_failure
  [[ $output == *"--root is required"* ]]
  [[ $output != *"Usage:"* ]]
}

@test "render requires a source outside a terminal" {
  run "$NEXTUI_AUTOMATION" render --device brick --root "$SDCARD"

  assert_failure
  [[ $output == *"render requires --source"* ]]
  [[ -z $(find "$SDCARD" -type f -print -quit) ]]
}

@test "render skips an unchanged owned BMP" {
  local root="$SDCARD/idempotent"
  local destination="$root/Tools/tg5040/Bootlogo.pak/brick"
  local expected="$destination/Nientiendo 1.bmp"

  run_render "brick" "$SOURCE" "$root"
  assert_success
  chmod 555 "$destination"

  run_render "brick" "$SOURCE" "$root"
  local second_status=$status second_output=$output
  chmod 755 "$destination"

  ((second_status == 0))
  [[ $second_output == *"unchanged:"* ]]
  assert_bmp "$expected" 1024 768
}

@test "detect identifies Smart Pro S from active tg5050 userdata" {
  mkdir -p "$SDCARD/.system/tg5040" "$SDCARD/.system/tg5050" "$SDCARD/.userdata/tg5050"

  run_detect "$SDCARD"

  assert_success
  [[ ${lines[${#lines[@]} - 1]} == "smartpros" ]]
}

@test "detect identifies Brick from runtime config while ignoring bundled platforms" {
  mkdir -p \
    "$SDCARD/.system/desktop" \
    "$SDCARD/.system/tg5040" \
    "$SDCARD/.system/tg5050" \
    "$SDCARD/.userdata/tg5040/SFC-snes9x" \
    "$SDCARD/Tools/tg5040/Bootlogo.pak" \
    "$SDCARD/Tools/tg5050/Bootlogo.pak"
  printf 'minarch_screen_scaling = Aspect\n' > \
    "$SDCARD/.userdata/tg5040/SFC-snes9x/minarch-brick.cfg"

  run_detect "$SDCARD"

  assert_success
  [[ ${lines[${#lines[@]} - 1]} == "brick" ]]
}

@test "detect identifies a tg5040 model from its runtime log" {
  mkdir -p "$SDCARD/.userdata/tg5040/logs"
  printf '[INFO] config.device_tag smartpro\n' >"$SDCARD/.userdata/tg5040/logs/SFC.txt"

  run_detect "$SDCARD"

  assert_success
  [[ ${lines[${#lines[@]} - 1]} == "smartpro" ]]
}

@test "detect requires an explicit model when bundled files have no runtime evidence" {
  mkdir -p "$SDCARD/.system/tg5040" "$SDCARD/.system/tg5050"

  run_detect "$SDCARD"

  assert_failure
  [[ $output == *"No unique runtime device evidence was found"* ]]
  [[ $output == *"Pass --device"* ]]
}

@test "detect rejects conflicting runtime device evidence" {
  mkdir -p "$SDCARD/.userdata/tg5040/FC" "$SDCARD/.userdata/tg5040/SFC"
  : >"$SDCARD/.userdata/tg5040/FC/minarch-brick.cfg"
  : >"$SDCARD/.userdata/tg5040/SFC/minarch-smartpro.cfg"

  run_detect "$SDCARD"

  assert_failure
  [[ $output == *"Conflicting runtime device evidence: brick, smartpro"* ]]
}

@test "detect rejects runtime userdata from multiple platform families" {
  mkdir -p "$SDCARD/.userdata/tg5040/FC" "$SDCARD/.userdata/tg5050"
  : >"$SDCARD/.userdata/tg5040/FC/minarch-brick.cfg"

  run_detect "$SDCARD"

  assert_failure
  [[ $output == *"Runtime userdata exists for multiple platforms: tg5040, tg5050"* ]]
}

@test "uninstall restores a boot logo replaced with explicit consent" {
  local destination="$SDCARD/Tools/tg5040/Bootlogo.pak/brick"
  local target="$destination/Nientiendo 1.bmp"
  local backup="$target.nientiendo-backup"
  mkdir -p "$destination"
  printf 'original device logo\n' >"$target"

  run_logos "brick" "$SOURCE" "$SDCARD"
  assert_success
  assert_bmp "$target" 1024 768
  [[ -f $backup ]]

  run_uninstall "$SDCARD"
  assert_success
  [[ $(<"$target") == "original device logo" ]]
  [[ ! -e $backup ]]
  [[ ! -e "$SDCARD/.nientiendo-nextui.json" ]]
}

@test "logos reports the model, resolution source, and destination" {
  local destination="$SDCARD/Tools/tg5040/Bootlogo.pak/brick"
  mkdir -p "$destination"

  run_logos "brick" "$SOURCE" "$SDCARD"

  assert_success
  [[ $output == *"Model: TrimUI Brick or Hammer (brick)"* ]]
  [[ $output == *"Resolved from: explicit --device option"* ]]
  [[ $output == *"Destination: $destination"* ]]
}

@test "just configure installs a device boot logo without exposing the internal CLI" {
  local destination="$SDCARD/Tools/tg5040/Bootlogo.pak/brick"
  mkdir -p "$destination"

  run just --justfile "$BATS_TEST_DIRNAME/../justfile" configure \
    --root "$SDCARD" \
    --device brick \
    --source "$SOURCE" \
    --yes

  assert_success
  assert_bmp "$destination/Nientiendo 1.bmp" 1024 768
  [[ $output != *"Usage:"* ]]
  [[ $output != *"bin/nextui"* ]]
}

@test "configure installs five numbered opaque logo variants with full colored backgrounds" {
  local destination="$SDCARD/Tools/tg5040/Bootlogo.pak/brick"
  local expected_backgrounds=("255 255 255" "230 0 18" "0 0 0" "0 0 0" "255 255 255")
  local expected_foregrounds=("230 0 18" "255 255 255" "230 0 18" "255 255 255" "0 0 0")
  mkdir -p "$destination"

  run "$NEXTUI_AUTOMATION" logos --device brick --root "$SDCARD" --yes

  assert_success
  [[ $(find "$destination" -maxdepth 1 -name 'Nientiendo *.bmp' | awk 'END { print NR }') == 5 ]]
  for index in 1 2 3 4 5; do
    local bmp="$destination/Nientiendo $index.bmp"
    assert_bmp "$bmp" 1024 768
    assert_bmp_pixel "$bmp" 512 0 "${expected_backgrounds[index - 1]}" 1
    assert_bmp_pixel "$bmp" 0 384 "${expected_backgrounds[index - 1]}" 1
    assert_bmp_pixel "$bmp" 85 384 "${expected_foregrounds[index - 1]}" 1
  done
}

@test "configure removes stale unmodified managed logo names" {
  local destination="$SDCARD/Tools/tg5040/Bootlogo.pak/brick"
  mkdir -p "$destination"

  run_logos "brick" "$SOURCE" "$SDCARD"
  assert_success
  mv "$destination/Nientiendo 1.bmp" "$destination/Nientiendo Test.bmp"
  sed -i '' 's/Nientiendo 1\.bmp/Nientiendo Test.bmp/g' "$SDCARD/.nientiendo-nextui.json"

  run "$NEXTUI_AUTOMATION" logos --device brick --root "$SDCARD" --yes

  assert_success
  [[ ! -e "$destination/Nientiendo Test.bmp" ]]
  [[ -f "$destination/Nientiendo 5.bmp" ]]
}

@test "one-off render does not remove other configured logo slots" {
  local destination="$SDCARD/Tools/tg5040/Bootlogo.pak/brick"
  mkdir -p "$destination"

  run "$NEXTUI_AUTOMATION" logos --device brick --root "$SDCARD" --yes
  assert_success

  run_render "brick" "$SOURCE" "$SDCARD"

  assert_success
  [[ -f "$destination/Nientiendo 1.bmp" ]]
  [[ -f "$destination/Nientiendo 5.bmp" ]]
}

@test "just command help shows the project command list" {
  run just --justfile "$BATS_TEST_DIRNAME/../justfile" configure --help

  assert_success
  [[ $output == *"configure *args"* ]]
  [[ $output != *"Usage:"* ]]
  [[ $output != *"nextui logos"* ]]
}

@test "invalid just command options fail with the project command list" {
  run just --justfile "$BATS_TEST_DIRNAME/../justfile" configure --unknown

  assert_failure
  [[ $output == *"configure *args"* ]]
  [[ $output != *"Usage:"* ]]
}

@test "just runtime failures do not append the project command list" {
  run just --justfile "$BATS_TEST_DIRNAME/../justfile" configure \
    --root "$SDCARD" \
    --device brick \
    --source "$SOURCE" \
    --yes

  assert_failure
  [[ $output == *"Bootlogo carousel is missing"* ]]
  [[ $output != *"configure *args"* ]]
}

@test "cleanup preserves an owned BMP that was modified after rendering" {
  local target="$SDCARD/Tools/tg5040/Bootlogo.pak/brick/Nientiendo 1.bmp"

  run_render "brick" "$SOURCE" "$SDCARD"
  assert_success
  printf 'user replacement\n' >"$target"

  run_cleanup "$SDCARD"

  assert_success
  [[ $(<"$target") == "user replacement" ]]
  [[ $output == *"preserved 1"* ]]
  [[ -f "$SDCARD/.nientiendo-nextui.json" ]]
}

@test "cleanup removes only generated BMPs and is idempotent" {
  local existing_bmp="$SDCARD/Tools/tg5040/Bootlogo.pak/brick/already-here.bmp"
  local existing_save="$SDCARD/Saves/owned-by-device.sav"
  local source_on_device="$SDCARD/Source Logos/Nientiendo Test.svg"
  mkdir -p "$(dirname "$existing_bmp")" "$(dirname "$existing_save")" "$(dirname "$source_on_device")"
  printf 'device bmp\n' >"$existing_bmp"
  printf 'device save\n' >"$existing_save"
  cp "$SOURCE" "$source_on_device"

  while IFS=$'\t' read -r device relative_dir _; do
    run_render "$device" "$source_on_device" "$SDCARD"
    assert_success
    [[ -f "$SDCARD/$relative_dir/Nientiendo 1.bmp" ]]
  done < <(device_rows)

  run_cleanup "$SDCARD"
  assert_success

  while IFS=$'\t' read -r _ relative_dir _; do
    [[ ! -e "$SDCARD/$relative_dir/Nientiendo 1.bmp" ]]
  done < <(device_rows)
  [[ $(<"$existing_bmp") == "device bmp" ]]
  [[ $(<"$existing_save") == "device save" ]]
  cmp "$SOURCE" "$source_on_device"

  run_cleanup "$SDCARD"
  assert_success
  [[ $(<"$existing_bmp") == "device bmp" ]]
  [[ $(<"$existing_save") == "device save" ]]
  cmp "$SOURCE" "$source_on_device"
}

@test "check compares the installed build with the latest release" {
  prepare_release_fixture
  mkdir -p "$SDCARD/.system/tg5040"
  printf '%s\nabc1234\n' "$RELEASE_BUILD" >"$SDCARD/.system/version.txt"

  run "$NEXTUI_AUTOMATION" check --root "$SDCARD"

  assert_success
  [[ $output == *"Installed: $RELEASE_BUILD"* ]]
  [[ $output == *"Latest: v9.0.0 ($RELEASE_BUILD)"* ]]
  [[ $output == *"Status: up to date"* ]]
}

@test "install copies a verified release to a compatible prepared card" {
  prepare_release_fixture

  run "$NEXTUI_AUTOMATION" install --root "$SDCARD" --kind base --yes

  assert_success
  [[ -f "$SDCARD/MinUI.zip" ]]
  [[ $(<"$SDCARD/trimui/app/bootstrap.txt") == "new bootstrap" ]]
  [[ $(<"$SDCARD/README.txt") == "NextUI fixture" ]]
  run unzip -Z1 "$SDCARD/MinUI.zip"
  assert_success
  [[ $output == *".system/version.txt"* ]]
}

@test "install can select the all archive with extra emulators" {
  prepare_release_fixture

  run "$NEXTUI_AUTOMATION" install --root "$SDCARD" --kind all --yes

  assert_success
  [[ $(<"$SDCARD/Emus/demo/readme.txt") == "extra emulator" ]]
}

@test "install succeeds without changing an existing installation" {
  prepare_release_fixture
  prepare_installed_card
  printf '%s\nabc1234\n' "$RELEASE_BUILD" >"$SDCARD/.system/version.txt"

  run "$NEXTUI_AUTOMATION" install --root "$SDCARD" --kind base --yes

  assert_success
  [[ $output == *"NextUI is already installed at $SDCARD; use update"* ]]
  [[ $(<"$SDCARD/trimui/app/bootstrap.txt") == "old bootstrap" ]]
}

@test "install rejects a card that is not FAT32 or exFAT with MBR" {
  prepare_release_fixture
  export NEXTUI_MEDIA_INFO='{"filesystem":"apfs","partitionScheme":"gpt"}'

  run "$NEXTUI_AUTOMATION" install --root "$SDCARD" --kind base --yes

  assert_failure
  [[ $output == *"Incompatible SD card"* ]]
  [[ $output == *"FAT32 or exFAT with a Master Boot Record"* ]]
  [[ ! -e "$SDCARD/MinUI.zip" ]]
}

@test "install rejects a directory below the mounted card root" {
  prepare_release_fixture
  local nested_root="$SDCARD/not-the-root"
  mkdir "$nested_root"
  export NEXTUI_MEDIA_INFO="{\"filesystem\":\"exfat\",\"partitionScheme\":\"mbr\",\"mountPoint\":\"$SDCARD\"}"

  run "$NEXTUI_AUTOMATION" install --root "$nested_root" --kind base --yes

  assert_failure
  [[ $output == *"Install target is not the mounted SD-card root"* ]]
  [[ $output == *"Select $SDCARD instead"* ]]
  [[ ! -e "$nested_root/MinUI.zip" ]]
}

@test "normal update stages only MinUI.zip" {
  prepare_release_fixture
  prepare_installed_card

  run "$NEXTUI_AUTOMATION" update --root "$SDCARD" --yes

  assert_success
  [[ -f "$SDCARD/MinUI.zip" ]]
  [[ $(<"$SDCARD/trimui/app/bootstrap.txt") == "old bootstrap" ]]
  [[ $output == *"normal update is ready"* ]]
}

@test "current update skips update mode selection" {
  prepare_release_fixture
  prepare_installed_card
  printf '%s\nabc1234\n' "$RELEASE_BUILD" >"$SDCARD/.system/version.txt"

  run env NEXTUI_TEST_COMMAND="$NEXTUI_AUTOMATION" NEXTUI_TEST_ROOT="$SDCARD" expect -c '
    spawn -noecho $env(NEXTUI_TEST_COMMAND) update --root $env(NEXTUI_TEST_ROOT) --yes
    expect {
      "Update mode" { send "\r"; exp_continue }
      eof
    }
    set result [wait]
    exit [lindex $result 3]
  '

  assert_success
  [[ $output == *"No update needed"* ]]
  [[ $output != *"Update mode"* ]]
}

@test "repair update also recopies the trimui bootstrap" {
  prepare_release_fixture
  prepare_installed_card

  run "$NEXTUI_AUTOMATION" update --root "$SDCARD" --repair --yes

  assert_success
  [[ -f "$SDCARD/MinUI.zip" ]]
  [[ $(<"$SDCARD/trimui/app/bootstrap.txt") == "new bootstrap" ]]
  [[ $output == *"repair update is ready"* ]]
}

@test "backup archives all SD-card data except macOS metadata" {
  local backup="$BATS_TEST_TMPDIR/Backups/nextui.zip"
  local restored="$BATS_TEST_TMPDIR/restored"
  mkdir -p \
    "$SDCARD/.system" \
    "$SDCARD/.userdata/shared" \
    "$SDCARD/Roms" \
    "$SDCARD/.Spotlight-V100" \
    "$SDCARD/.Trashes" \
    "$SDCARD/.fseventsd"
  printf 'NextUI-20260829-0\nabc1234\n' >"$SDCARD/.system/version.txt"
  printf 'save data\n' >"$SDCARD/.userdata/shared/game.sav"
  printf 'rom data\n' >"$SDCARD/Roms/game.rom"
  printf 'metadata\n' >"$SDCARD/.DS_Store"
  printf 'metadata\n' >"$SDCARD/.Spotlight-V100/index"
  printf 'metadata\n' >"$SDCARD/.Trashes/deleted"
  printf 'metadata\n' >"$SDCARD/.fseventsd/log"

  run "$NEXTUI_AUTOMATION" backup --root "$SDCARD" --output "$backup" --yes

  assert_success
  [[ -f $backup ]]
  mkdir "$restored"
  unzip -q "$backup" -d "$restored"
  [[ $(<"$restored/.system/version.txt") == "NextUI-20260829-0"$'\n'"abc1234" ]]
  [[ $(<"$restored/.userdata/shared/game.sav") == "save data" ]]
  [[ $(<"$restored/Roms/game.rom") == "rom data" ]]
  [[ ! -e "$restored/.DS_Store" ]]
  [[ ! -e "$restored/.Spotlight-V100" ]]
  [[ ! -e "$restored/.Trashes" ]]
  [[ ! -e "$restored/.fseventsd" ]]
  [[ $(<"$SDCARD/Roms/game.rom") == "rom data" ]]
  [[ $output == *"Backup complete: $backup"* ]]
}

@test "backup refuses to create its archive on the source card" {
  printf 'save data\n' >"$SDCARD/game.sav"

  run "$NEXTUI_AUTOMATION" backup \
    --root "$SDCARD" \
    --output "$SDCARD/nextui-backup.zip" \
    --yes

  assert_failure
  [[ $output == *"Backup output must be outside the SD card"* ]]
  [[ ! -e "$SDCARD/nextui-backup.zip" ]]
}
