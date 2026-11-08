# VESC Tool parameter definitions

`config/<firmware>/parameters_mcconf.xml` and `parameters_appconf.xml` are copied
unchanged from VESC Tool (`res/config/<firmware>/` in
https://github.com/vedderb/vesc_tool), by Benjamin Vedder and contributors,
licensed GPL-3.0.

They describe every motor (mcconf) and app (appconf) setting: name, type, limits,
default, help text, and the order the firmware serializes them in.

`npm run gen:config` turns them into the JSON files in `src/config/defs/`.
`npm run gen:fw-layouts` reads the firmware's own serializer (`confgenerator.c`
and `confgenerator.h` in https://github.com/vedderb/bldc) and records its field
layout and signatures, so the tests can prove the two agree.

To add a firmware version: copy its folder from VESC Tool, add the release branch
to `scripts/gen-fw-layouts.ts`, then run both scripts and the tests.
