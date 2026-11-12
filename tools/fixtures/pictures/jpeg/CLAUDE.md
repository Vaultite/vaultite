# JPEG fixtures

Every source picture is synthetic, drawn by a Python script with PIL 12: gradients, seeded random rectangles and ellipses, seeded pixel noise. Nothing is taken from another file. Each `<name>.ref.png` (RGB) is Pillow 12's decode of `<name>.jpg` (libjpeg-turbo 3.1, its defaults: islow IDCT, fancy upsampling), unless said otherwise; the test holds the decoder to it exactly. CI can't remake them: they're committed as made.

Pillow's `save`: 444, 422, 420 (64x48; `subsampling=0/1/2`, quality 85), odd (37x23, 4:2:0), odd-422 (37x23), tiny-420 (3x3: chroma too narrow for fancy upsampling), gray, progressive (80x56, `progressive=True`: libjpeg's script, with successive approximation and refinement scans), cmyk (48x32, Adobe APP14, inverted), timing (800x600 4:2:0 quality 30, no reference: only timed).

cjpeg (libjpeg-turbo 3.2) from the same pictures as PPM: 411 (`-sample 4x1,1x1,1x1`), 440 (`-sample 1x2,1x1,1x1`), odd-sampling (45x29, `-sample 2x2,1x2,2x1`), gray-2x2 (45x29 grey, `-sample 2x2`: a lone component's scan walks its own blocks), progressive-444 (41x27, `-sample 1x1,1x1,1x1 -progressive`), restart (`-restart 2B`), sof1 (`-quality 2`: 16-bit quantization tables, so SOF1), multiscan (45x29 4:2:0, `-scans` with one sequential scan a component: `0: 0 63 0 0; 2: 0 63 0 0; 1: 0 63 0 0;`), rgb (`-rgb`: Adobe transform 0, ids 'R', 'G', 'B').

Others: progressive-restart is `jpegtran -progressive -restart 3B restart.jpg`. rgb-ids is rgb.jpg with its APP14 segment cut out, so only the components' ids say RGB. ycck (48x32, Y and K 2x2) is written by a few lines of C against libjpeg-turbo: `in_color_space = JCS_CMYK`, `jpeg_set_colorspace(JCS_YCCK)`, quality 90, given the cmyk picture's inverted bytes; Pillow reads it as CMYK and converts to RGB like cmyk.jpg.

orient-1 to orient-8 (24x16, 4:4:4, quality 90): Pillow's save, then an APP1 segment inserted after SOI holding a minimal Exif (IFD0 with only the orientation tag), big-endian (MM) for odd numbers, little-endian (II) for even. Their references are `ImageOps.exif_transpose`'d.

Damaged ones, their references djpeg's (libjpeg-turbo 3.2; Pillow refuses a cut-short file): restart-ahead is restart.jpg with its RST1 marker renumbered RST2, restart-missing is restart.jpg with its RST1 cut out, cut is 420.jpg's first 80% of bytes.
