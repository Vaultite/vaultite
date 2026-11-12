# WebP lossless fixtures

Made with `cwebp -lossless -metadata none` (libwebp 1.6) from PNGs drawn with PIL 12, all procedural (smooth fields of correlated channels, soft shapes, grain; nothing from someone else's picture). Each is kept for something no other fixture uses, as an instrumented decode showed.

- photo (120x80, -z 9): predictor modes 1 to 13, the colour transform, meta prefix codes of 2 bits.
- alpha (64x64, a radial alpha, -z 6): meta prefix codes of 3 bits, a colour cache of 7 bits. alpha-odd (37x23, alpha in stripes, -exact).
- Sizes: odd (37x23), gradient (64x48, -z 9: a 5-bit cache), one-row (300x1), one-column (1x77), tiny (1x1), tiny-clear (1x1, transparent, -exact).
- Colour indexing: pal2 (37x23, -z 9: 8 pixels a byte), pal4 (41x27 blocks, -z 0: 4 a byte), pal16 (a 64x48 ramp, -z 9: 2 a byte, under a predictor), pal-alpha (29x17, 11 translucent colours, -z 0), pal200 (50x40, -z 3: a 1-bit cache, distances past the 120 nearest pixels).
- screen (480x320, drawn UI and text, -z 6): subtract green, LZ77, an 8-bit cache; the largest, whose decode time the test logs.
- lossy-alpha (64x64) and lossy-alpha-odd (37x23): lossy with lossless, unfiltered alpha (`cwebp -q 80 -alpha_q 100 -alpha_filter none -exact`), for the ALPH chunk's stream (an implicit size).

References (`<name>.ref.png`) are `dwebp`'s, matched exactly; for lossy-alpha* only their alpha is compared, with the stream's green.

Not covered, as libwebp's encoder never makes them: predictor mode 0 and meta groups the entropy image doesn't use.
