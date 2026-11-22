#!/usr/bin/env python3
"""Create a non-invasive overlay test from the exact pinned NDL sample main."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
folder = root / "media/ndl/esplayer"
source = (folder / "main.c").read_text()
anchor = '    sdl_shell_present_transparent(&shell);'
assert source.count(anchor) == 1, "Unexpected upstream NDL sample; do not patch"

overlay = '''    sdl_shell_present_transparent(&shell);
    /* A tiny opaque UI overlay on top of the *known-good* hardware video path.
       Video remains visible everywhere else. No new SDL window or second app. */
    SDL_SetRenderDrawBlendMode(shell.renderer, SDL_BLENDMODE_NONE);
    SDL_SetRenderDrawColor(shell.renderer, 0, 0, 0, 0);
    SDL_RenderClear(shell.renderer);
    SDL_Rect top = {shell.display_width / 12, shell.display_height / 12,
                    shell.display_width * 5 / 6, shell.display_height / 10};
    SDL_Rect bottom = {shell.display_width / 12, shell.display_height * 4 / 5,
                       shell.display_width * 5 / 6, shell.display_height / 10};
    SDL_SetRenderDrawColor(shell.renderer, 0, 210, 230, 255);
    SDL_RenderFillRect(shell.renderer, &top);
    SDL_SetRenderDrawColor(shell.renderer, 240, 60, 75, 255);
    SDL_RenderFillRect(shell.renderer, &bottom);
    SDL_RenderPresent(shell.renderer);
    fprintf(stderr, "[overlay-smoke] overlay submitted above NDL hardware video\\n");'''
(folder / "overlay_main.c").write_text(source.replace(anchor, overlay, 1))

cmake = folder / "CMakeLists.txt"
cmake.write_text(cmake.read_text() + '''
# Baseline video playback untouched; only a second C entry draws two bars
# on its original SDL renderer *after* the transparent window is opened.
add_executable(media-lab-overlay-smoke overlay_main.c esplayer.c)
target_include_directories(media-lab-overlay-smoke SYSTEM PRIVATE ${NDL_DM2_INCLUDE_DIRS})
target_link_libraries(media-lab-overlay-smoke PRIVATE
    media-common media-common-sdl ${NDL_DM2_LIBRARIES})
set_target_properties(media-lab-overlay-smoke PROPERTIES
    INSTALL_RPATH "$ORIGIN" BUILD_WITH_INSTALL_RPATH TRUE)
''')
print("Created NDL known-good baseline overlay smoke target")
